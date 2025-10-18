import { COMMON_RESPONSE_TOOLS, TOOLS_DICT } from './tools';

export type FetchrLLMToolType = keyof typeof TOOLS_DICT;

export type FetchrLLMTool = (typeof TOOLS_DICT)[FetchrLLMToolType];

export type FetchrLLMCommonResponseToolType = keyof typeof COMMON_RESPONSE_TOOLS;
