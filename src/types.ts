import type { QuestionArgs } from "./translation";

export type MaybeUndefined<T> = T | undefined;

export type ToolOutput = {
  output: string;
  metadata: unknown;
};

export type QuestionTranslation = {
  original: QuestionArgs;
  localized: QuestionArgs;
};
