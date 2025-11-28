# -*- coding: utf-8 -*-

# Copyright (c) 2025 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: Apache-2.0

"""
Debug and development routes
"""

import json
import time
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Body, Depends, Query

from opencontext.models.enums import VaultType
from opencontext.server.middleware.auth import auth_dependency
from opencontext.server.opencontext import OpenContext
from opencontext.server.utils import convert_resp, get_context_lab
from opencontext.storage.global_storage import get_storage
from opencontext.utils.logging_utils import get_logger

logger = get_logger(__name__)
router = APIRouter(tags=["debug"])

# Helpers for admin actions
def _clear_activity_table():
    storage = get_storage()
    backend = getattr(storage, "_document_backend", None)
    if backend is None:
        return False, "Document backend not initialized"

    # Try raw SQL if SQLite backend
    conn = getattr(backend, "connection", None)
    if conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM activity")
        conn.commit()
        return True, "Activity table cleared"

    return False, "Unsupported backend for clearing activities"


def _clear_processed_contexts():
    storage = get_storage()
    if storage is None:
        return False, "Storage not initialized"

    try:
        if hasattr(storage, "get_all_processed_contexts"):
            deleted = 0
            offset = 0
            batch = 500
            while True:
                contexts_dict = storage.get_all_processed_contexts(limit=batch, offset=offset, filter={})  # type: ignore
                all_ctx = []
                for _, lst in (contexts_dict or {}).items():
                    all_ctx.extend(lst or [])
                if not all_ctx:
                    break
                for ctx in all_ctx:
                    ctx_id = getattr(ctx, "id", None) or (ctx.get("id") if isinstance(ctx, dict) else None)
                    ctx_type = None
                    if hasattr(ctx, "extracted_data"):
                        ctx_type = getattr(ctx.extracted_data, "context_type", None)
                    elif isinstance(ctx, dict):
                        ctx_type = ctx.get("extracted_data", {}).get("context_type") or ctx.get("context_type")
                    if hasattr(ctx_type, "value"):
                        ctx_type = ctx_type.value
                    if ctx_id and ctx_type:
                        storage.delete_processed_context(ctx_id, ctx_type)
                        deleted += 1
                offset += batch
            return True, f"Deleted {deleted} processed contexts"

        return True, "Context clearing not supported for current storage backend"
    except Exception as e:
        logger.exception(f"Failed to clear processed contexts: {e}")
        return False, str(e)


def _clear_all_data():
    ok_ctx, msg_ctx = _clear_processed_contexts()
    ok_act, msg_act = _clear_activity_table()
    success = ok_ctx and ok_act
    msg = f"contexts: {msg_ctx}; activities: {msg_act}"
    return success, msg


@router.get("/api/debug/reports")
async def get_debug_reports(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    is_deleted: bool = Query(False),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Get SQLite report table data (for debugging)"""
    try:
        reports = get_storage().get_reports(limit=limit, offset=offset, is_deleted=is_deleted)
        logger.info(f"Successfully retrieved report list, {len(reports)} records in total")
        return convert_resp(data={"reports": reports, "total": len(reports)})

    except Exception as e:
        logger.exception(f"Error getting debug reports: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to get debug reports: {str(e)}")


@router.get("/api/debug/todos")
async def get_debug_todos(
    status: Optional[int] = Query(None, description="0=incomplete, 1=complete"),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Get SQLite todo table data (for debugging)"""
    try:
        todos = get_storage().get_todos(status=status, limit=limit, offset=offset)
        return convert_resp(data={"todos": todos, "total": len(todos)})

    except Exception as e:
        logger.exception(f"Error getting debug todos: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to get debug todos: {str(e)}")


@router.get("/api/debug/activities")
async def get_debug_activities(
    start_time: Optional[str] = Query(None, description="Start time in ISO format"),
    end_time: Optional[str] = Query(None, description="End time in ISO format"),
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Get SQLite activity record table data (for debugging)"""
    try:
        from datetime import datetime

        start_dt = datetime.fromisoformat(start_time) if start_time else None
        end_dt = datetime.fromisoformat(end_time) if end_time else None

        activities = get_storage().get_activities(
            start_time=start_dt, end_time=end_dt, limit=limit, offset=offset
        )

        for activity in activities:
            if activity.get("resources"):
                try:
                    activity["resources"] = json.loads(activity["resources"])
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning(
                        f"Failed to parse resources for activity {activity.get('id')}: {e}, raw: {activity.get('resources')}"
                    )
                    activity["resources"] = None

        return convert_resp(data={"activities": activities, "total": len(activities)})

    except Exception as e:
        logger.exception(f"Error getting debug activities: {e}")
        return convert_resp(
            code=500, status=500, message=f"Failed to get debug activities: {str(e)}"
        )


@router.get("/api/debug/tips")
async def get_debug_tips(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Get SQLite tips table data (for debugging)"""
    try:
        tips = get_storage().get_tips(limit=limit, offset=offset)
        return convert_resp(data={"tips": tips, "total": len(tips)})

    except Exception as e:
        logger.exception(f"Error getting debug tips: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to get debug tips: {str(e)}")


@router.patch("/api/debug/todos/{todo_id}")
async def update_debug_todo_status(
    todo_id: int,
    status: int = Query(..., description="0=incomplete, 1=complete"),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Update todo status (for debugging)"""
    try:
        from datetime import datetime

        end_time = datetime.now() if status == 1 else None
        success = get_storage().update_todo_status(todo_id, status, end_time)

        if success:
            return convert_resp(data={"message": "Todo status updated successfully"})
        else:
            return convert_resp(code=404, status=404, message="Todo not found")

    except Exception as e:
        logger.exception(f"Error updating debug todo status: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to update todo: {str(e)}")


@router.post("/api/debug/generate/report")
async def manual_generate_debug_report(
    start_time: Optional[int] = None,
    end_time: Optional[int] = None,
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Manually generate daily report (for debugging)"""
    try:
        if not hasattr(opencontext, "consumption_manager") or not opencontext.consumption_manager:
            return convert_resp(code=500, status=500, message="Consumption manager not initialized")

        if not opencontext.consumption_manager._activity_generator:
            return convert_resp(code=500, status=500, message="Activity generator not initialized")

        if start_time is None or end_time is None:
            from datetime import datetime, timedelta

            now = datetime.now()
            end_time = int(now.timestamp())
            start_time = int((now - timedelta(days=1)).timestamp())

        report_content = await opencontext.consumption_manager._activity_generator.generate_report(
            start_time, end_time
        )

        if report_content:
            from datetime import datetime

            return convert_resp(
                data={
                    "content": report_content,
                    "summary": "",
                    "message": "Report generated successfully",
                }
            )
        else:
            return convert_resp(code=404, status=404, message="No content to generate report")

    except Exception as e:
        logger.exception(f"Error generating debug report: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to generate report: {str(e)}")


@router.post("/api/debug/generate/activity")
async def manual_generate_debug_activity(
    minutes: int = 15,
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Manually generate activity record (for debugging)"""
    try:
        if not hasattr(opencontext, "consumption_manager") or not opencontext.consumption_manager:
            return convert_resp(code=500, status=500, message="Consumption manager not initialized")

        if not opencontext.consumption_manager._real_activity_monitor:
            return convert_resp(code=500, status=500, message="Activity monitor not initialized")

        start_time = int(datetime.now().timestamp()) - (minutes * 60)
        end_time = int(datetime.now().timestamp())
        activity_result = opencontext.consumption_manager._real_activity_monitor.generate_realtime_activity_summary(
            start_time, end_time
        )

        if activity_result:
            return convert_resp(
                data={
                    "activity_id": activity_result.get("activity_id"),
                    "title": activity_result.get("title"),
                    "description": activity_result.get("description"),
                    "message": "Activity generated successfully",
                }
            )
        else:
            return convert_resp(code=404, status=404, message="No content to generate activity")

    except Exception as e:
        logger.exception(f"Error generating debug activity: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to generate activity: {str(e)}")


@router.post("/api/debug/generate/tips")
async def manual_generate_debug_tips(
    lookback_minutes: int = Query(60, description="Lookback minutes"),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Manually generate tips (for debugging)"""
    try:
        if not hasattr(opencontext, "consumption_manager") or not opencontext.consumption_manager:
            return convert_resp(code=500, status=500, message="Consumption manager not initialized")

        if not opencontext.consumption_manager._smart_tip_generator:
            return convert_resp(code=500, status=500, message="Tip generator not initialized")

        end_time = int(datetime.now().timestamp())
        start_time = end_time - (lookback_minutes * 60)
        tip_id = opencontext.consumption_manager._smart_tip_generator.generate_smart_tip(
            start_time, end_time
        )

        if tip_id:
            return convert_resp(data={"tip_id": tip_id, "message": "Tip generated successfully"})
        else:
            return convert_resp(code=404, status=404, message="No content to generate tip")

    except Exception as e:
        logger.exception(f"Error generating debug tip: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to generate tip: {str(e)}")


@router.post("/api/debug/generate/todos")
async def manual_generate_debug_todos(
    lookback_minutes: int = Query(30, description="Lookback minutes"),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Manually generate todos (for debugging)"""
    try:
        if not hasattr(opencontext, "consumption_manager") or not opencontext.consumption_manager:
            return convert_resp(code=500, status=500, message="Consumption manager not initialized")

        if not opencontext.consumption_manager._smart_todo_manager:
            return convert_resp(code=500, status=500, message="Todo manager not initialized")

        start_time = int((datetime.now() - timedelta(minutes=lookback_minutes)).timestamp())
        end_time = int(datetime.now().timestamp())
        todo_id = opencontext.consumption_manager._smart_todo_manager.generate_todo_tasks(
            start_time=start_time,
            end_time=end_time,
        )

        if todo_id:
            return convert_resp(
                data={"todo_batch_id": todo_id, "message": "Todos generated successfully"}
            )
        else:
            return convert_resp(code=404, status=404, message="No content to generate todos")

    except Exception as e:
        logger.exception(f"Error generating debug todos: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to generate todos: {str(e)}")


# --- Admin aliases for frontend debug buttons ---

@router.post("/api/admin/generate_activity_now")
async def admin_generate_activity_now(opencontext: OpenContext = Depends(get_context_lab), _auth: str = auth_dependency):
    """Alias to manual activity generation for admin/debug buttons."""
    return await manual_generate_debug_activity(minutes=15, opencontext=opencontext, _auth=_auth)  # type: ignore


@router.post("/api/admin/generate_summary_now")
async def admin_generate_summary_now(opencontext: OpenContext = Depends(get_context_lab), _auth: str = auth_dependency):
    """Alias to manual report generation for admin/debug buttons."""
    return await manual_generate_debug_report(start_time=None, end_time=None, opencontext=opencontext, _auth=_auth)  # type: ignore


@router.post("/api/admin/clear_contexts")
async def admin_clear_contexts(_auth: str = auth_dependency):
    ok, msg = _clear_processed_contexts()
    if ok:
        return convert_resp(data={"message": msg})
    return convert_resp(code=500, status=500, message=msg)


@router.post("/api/admin/clear_activities")
async def admin_clear_activities(_auth: str = auth_dependency):
    ok, msg = _clear_activity_table()
    if ok:
        return convert_resp(data={"message": msg})
    return convert_resp(code=500, status=500, message=msg)


@router.post("/api/admin/clear_all")
async def admin_clear_all(_auth: str = auth_dependency):
    ok, msg = _clear_all_data()
    if ok:
        return convert_resp(data={"message": msg})
    return convert_resp(code=500, status=500, message=msg)


@router.get("/api/debug/prompts/export")
async def export_debug_prompts(
    include_custom: bool = Query(True, description="Include custom modifications"),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Export all generation prompts (for debugging)"""
    try:
        from opencontext.config.global_config import get_prompt_manager

        prompt_manager = get_prompt_manager()

        if not prompt_manager:
            return convert_resp(code=500, status=500, message="Prompt manager not initialized")

        # Get original generation prompts
        generation_prompts = prompt_manager.prompts.get("generation", {})

        # If custom modifications should be included
        custom_prompts_dict = getattr(opencontext, "_custom_prompts", {})

        # Build export data
        export_data = {
            "version": "1.0",
            "timestamp": int(time.time()),
            "is_custom": include_custom and len(custom_prompts_dict) > 0,
            "prompts": {},
        }

        # For each category, prioritize custom version
        categories = {
            "tips": "smart_tip_generation",
            "todo": "todo_extraction",
            "report": "generation_report",
            "activity": "realtime_activity_monitor",
        }

        for cat_key, prompt_key in categories.items():
            full_path = f"generation.{prompt_key}"
            if include_custom and full_path in custom_prompts_dict:
                export_data["prompts"][cat_key] = custom_prompts_dict[full_path]
            else:
                export_data["prompts"][cat_key] = generation_prompts.get(prompt_key, {})

        return convert_resp(data=export_data)

    except Exception as e:
        logger.exception(f"Error exporting debug prompts: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to export prompts: {str(e)}")


@router.post("/api/debug/prompts/restore")
async def restore_debug_prompts(
    prompts_data: dict = Body(...),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Restore prompts to specified version (for debugging)"""
    try:
        from opencontext.config.global_config import get_prompt_manager

        prompt_manager = get_prompt_manager()

        if not prompt_manager:
            return convert_resp(code=500, status=500, message="Prompt manager not initialized")

        # Validate data format
        if "prompts" not in prompts_data:
            return convert_resp(code=400, status=400, message="Invalid prompts data format")

        restored_prompts = prompts_data["prompts"]

        # Update prompts in memory
        if not hasattr(opencontext, "_custom_prompts"):
            opencontext._custom_prompts = {}

        # Map and store prompts
        if "tips" in restored_prompts:
            opencontext._custom_prompts["generation.smart_tip_generation"] = restored_prompts[
                "tips"
            ]
        if "todo" in restored_prompts:
            opencontext._custom_prompts["generation.todo_extraction"] = restored_prompts["todo"]
        if "report" in restored_prompts:
            opencontext._custom_prompts["generation.generation_report"] = restored_prompts["report"]
        if "activity" in restored_prompts:
            opencontext._custom_prompts["generation.realtime_activity_monitor"] = restored_prompts[
                "activity"
            ]

        return convert_resp(
            data={
                "message": "Prompts restored successfully",
                "restored_count": len(opencontext._custom_prompts),
            }
        )

    except Exception as e:
        logger.exception(f"Error restoring debug prompts: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to restore prompts: {str(e)}")


@router.get("/api/debug/prompts/{category}")
async def get_debug_prompts(
    category: str, opencontext: OpenContext = Depends(get_context_lab), _auth: str = auth_dependency
):
    """Get prompts for specified category (for debugging)"""
    try:
        from opencontext.config.global_config import get_prompt_manager

        prompt_manager = get_prompt_manager()

        if not prompt_manager:
            return convert_resp(code=500, status=500, message="Prompt manager not initialized")

        # Map category to actual prompt path
        category_map = {
            "tips": "generation.smart_tip_generation",
            "todo": "generation.todo_extraction",
            "report": "generation.generation_report",
            "activity": "generation.realtime_activity_monitor",
        }

        if category not in category_map:
            return convert_resp(code=400, status=400, message=f"Invalid category: {category}")

        prompt_path = category_map[category]

        # Prioritize returning custom prompts, otherwise return original prompts
        custom_prompts = getattr(opencontext, "_custom_prompts", {})
        if prompt_path in custom_prompts:
            prompts = custom_prompts[prompt_path]
            is_custom = True
        else:
            prompts = prompt_manager.get_prompt_group(prompt_path)
            is_custom = False

        if not prompts:
            return convert_resp(
                code=404, status=404, message=f"Prompts not found for category: {category}"
            )

        # Also return original prompts for frontend restore functionality
        original_prompts = prompt_manager.get_prompt_group(prompt_path)

        return convert_resp(
            data={
                "category": category,
                "prompts": prompts,
                "original_prompts": original_prompts,
                "is_custom": is_custom,
                "path": prompt_path,
            }
        )

    except Exception as e:
        logger.exception(f"Error getting debug prompts: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to get prompts: {str(e)}")


@router.post("/api/debug/prompts/{category}")
async def update_debug_prompts(
    category: str,
    prompts: dict = Body(...),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Update prompts for specified category (for debugging)"""
    try:
        from opencontext.config.global_config import get_prompt_manager

        prompt_manager = get_prompt_manager()

        if not prompt_manager:
            return convert_resp(code=500, status=500, message="Prompt manager not initialized")

        # Map category to actual prompt path
        category_map = {
            "tips": "generation.smart_tip_generation",
            "todo": "generation.todo_extraction",
            "report": "generation.generation_report",
            "activity": "generation.realtime_activity_monitor",
        }

        if category not in category_map:
            return convert_resp(code=400, status=400, message=f"Invalid category: {category}")

        prompt_path = category_map[category]

        # Validate prompts format
        if "system" not in prompts or "user" not in prompts:
            return convert_resp(
                code=400, status=400, message="Prompts must contain 'system' and 'user' fields"
            )

        # Store temporary prompts to session or cache
        if not hasattr(opencontext, "_custom_prompts"):
            opencontext._custom_prompts = {}

        opencontext._custom_prompts[prompt_path] = prompts

        return convert_resp(
            data={
                "category": category,
                "message": "Prompts updated successfully",
                "path": prompt_path,
            }
        )

    except Exception as e:
        logger.exception(f"Error updating debug prompts: {e}")
        return convert_resp(code=500, status=500, message=f"Failed to update prompts: {str(e)}")


@router.post("/api/debug/generate/{category}/custom")
async def generate_with_custom_prompts(
    category: str,
    lookback_minutes: int = Query(15, description="Lookback minutes"),
    start_time: int = Query(None, description="Start timestamp"),
    end_time: int = Query(None, description="End timestamp"),
    opencontext: OpenContext = Depends(get_context_lab),
    _auth: str = auth_dependency,
):
    """Generate content with custom prompts (for debugging)"""
    try:
        if not hasattr(opencontext, "consumption_manager") or not opencontext.consumption_manager:
            return convert_resp(code=500, status=500, message="Consumption manager not initialized")

        # Get custom prompts
        custom_prompts = getattr(opencontext, "_custom_prompts", {})

        # Execute corresponding generation task based on category
        if category == "tips":
            if not opencontext.consumption_manager._smart_tip_generator:
                return convert_resp(code=500, status=500, message="Tip generator not initialized")

            # Temporarily replace prompts
            original_prompts = None
            if custom_prompts.get("generation.smart_tip_generation"):
                from opencontext.config.global_config import get_prompt_manager

                prompt_manager = get_prompt_manager()
                original_prompts = prompt_manager.prompts.get("generation", {}).get(
                    "smart_tip_generation", {}
                )
                prompt_manager.prompts["generation"]["smart_tip_generation"] = custom_prompts[
                    "generation.smart_tip_generation"
                ]

            try:
                tip_id = opencontext.consumption_manager._smart_tip_generator.generate_smart_tip(
                    lookback_minutes=lookback_minutes or 15
                )

                return (
                    convert_resp(
                        data={"tip_id": tip_id, "message": "Tip generated with custom prompts"}
                    )
                    if tip_id
                    else convert_resp(code=404, status=404, message="No content to generate tip")
                )

            finally:
                # Restore original prompts
                if original_prompts:
                    prompt_manager.prompts["generation"]["smart_tip_generation"] = original_prompts

        elif category == "todo":
            if not opencontext.consumption_manager._smart_todo_manager:
                return convert_resp(code=500, status=500, message="Todo manager not initialized")

            # Temporarily replace prompts
            original_prompts = None
            if custom_prompts.get("generation.todo_extraction"):
                from opencontext.config.global_config import get_prompt_manager

                prompt_manager = get_prompt_manager()
                original_prompts = prompt_manager.prompts.get("generation", {}).get(
                    "todo_extraction", {}
                )
                prompt_manager.prompts["generation"]["todo_extraction"] = custom_prompts[
                    "generation.todo_extraction"
                ]

            try:
                todo_id = opencontext.consumption_manager._smart_todo_manager.generate_todo_tasks(
                    lookback_minutes=lookback_minutes or 30
                )

                return (
                    convert_resp(
                        data={
                            "todo_batch_id": todo_id,
                            "message": "Todos generated with custom prompts",
                        }
                    )
                    if todo_id
                    else convert_resp(code=404, status=404, message="No content to generate todos")
                )

            finally:
                # Restore original prompts
                if original_prompts:
                    prompt_manager.prompts["generation"]["todo_extraction"] = original_prompts

        elif category == "report":
            if not opencontext.consumption_manager._activity_generator:
                return convert_resp(
                    code=500, status=500, message="Activity generator not initialized"
                )

            # Handle time parameters
            if start_time is None or end_time is None:
                from datetime import datetime, timedelta

                now = datetime.now()
                end_time = int(now.timestamp())
                start_time = int((now - timedelta(days=1)).timestamp())

            # Temporarily replace prompts
            original_prompts = None
            if custom_prompts.get("generation.generation_report"):
                from opencontext.config.global_config import get_prompt_manager

                prompt_manager = get_prompt_manager()
                original_prompts = prompt_manager.prompts.get("generation", {}).get(
                    "generation_report", {}
                )
                prompt_manager.prompts["generation"]["generation_report"] = custom_prompts[
                    "generation.generation_report"
                ]

            try:
                report_content = (
                    await opencontext.consumption_manager._activity_generator.generate_report(
                        start_time, end_time
                    )
                )

                if report_content and len(report_content.strip()) > 50:
                    summary = opencontext.consumption_manager._generate_summary(report_content)
                    return convert_resp(
                        data={
                            "content": report_content,
                            "summary": summary,
                            "message": "Report generated with custom prompts",
                        }
                    )
                else:
                    return convert_resp(
                        code=404, status=404, message="No content to generate report"
                    )

            finally:
                # Restore original prompts
                if original_prompts:
                    prompt_manager.prompts["generation"]["generation_report"] = original_prompts

        elif category == "activity":
            if not opencontext.consumption_manager._real_activity_monitor:
                return convert_resp(
                    code=500, status=500, message="Activity monitor not initialized"
                )

            # Temporarily replace prompts
            original_prompts = None
            if custom_prompts.get("generation.realtime_activity_monitor"):
                from opencontext.config.global_config import get_prompt_manager

                prompt_manager = get_prompt_manager()
                original_prompts = prompt_manager.prompts.get("generation", {}).get(
                    "realtime_activity_monitor", {}
                )
                prompt_manager.prompts["generation"]["realtime_activity_monitor"] = custom_prompts[
                    "generation.realtime_activity_monitor"
                ]

            try:
                activity_result = opencontext.consumption_manager._real_activity_monitor.generate_realtime_activity_summary(
                    minutes=lookback_minutes or 15
                )
                logger.info(f"activity_result: {activity_result}")
                if activity_result:
                    return convert_resp(activity_result)
                else:
                    return convert_resp(
                        code=404, status=404, message="No content to generate activity"
                    )

            finally:
                # Restore original prompts
                if original_prompts:
                    prompt_manager.prompts["generation"][
                        "realtime_activity_monitor"
                    ] = original_prompts
        else:
            return convert_resp(code=400, status=400, message=f"Invalid category: {category}")

    except Exception as e:
        logger.exception(f"Error generating with custom prompts: {e}")
        return convert_resp(
            code=500, status=500, message=f"Failed to generate with custom prompts: {str(e)}"
        )
