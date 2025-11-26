// Copyright (c) 2025 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: Apache-2.0

import { ReactNode } from 'react'
import custom from '../../assets/images/settings/custom.svg'

export enum ModelTypeList {
  Ollama = 'ollama'
}

export interface OptionInfo {
  value: string
  label: string
}
export interface ModelInfo {
  icon: ReactNode
  key: string
  value: string
  option?: OptionInfo[]
}

export const ModelInfoList = [
  {
    icon: <img src={custom} className="!max-w-none w-[18px] h-[18px]" />,
    key: 'Ollama',
    value: ModelTypeList.Ollama
  }
]
