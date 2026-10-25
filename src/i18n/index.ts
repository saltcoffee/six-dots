import { en } from './en';
import { zh } from './zh';

export type Message = keyof typeof en;
export function isChinese(language: string): boolean { return /^zh(?:[-_]|$)/i.test(language.trim()); }
export function translator(language: string) {
  const messages = isChinese(language) ? zh : en;
  return (key: Message): string => messages[key];
}
export type Translate = ReturnType<typeof translator>;
