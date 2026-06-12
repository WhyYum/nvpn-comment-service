import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Lang {
  common: {
    back: string;
    mainMenu: string;
    accountsMenu: string;
    yes: string;
    no: string;
    cancel: string;
    notFound: string;
    notTextMessage: string;
    categoryBS: string;
    categoryRegular: string;
  };
  access: {
    denied: string;
  };
  menu: {
    main: {
      title: string;
      accounts: string;
      addAccount: string;
      addKeywords: string;
      addTemplates: string;
      stats: string;
      logs: string;
      limits: string;
      checkStatuses: string;
    };
    accounts: {
      empty: string;
      btnStop: string;
      btnStart: string;
      btnCheck: string;
      btnDelete: string;
      deleteConfirm: string;
      deleteYes: string;
      checkStarted: string;
      checkDone: string;
      checkReasonSuffix: string;
    };
    logs: {
      hint: string;
      empty: string;
      fileCaption: string;
      filterError: string;
      filterWarn: string;
      filterAll: string;
    };
  };
  statusCheck: {
    starting: string;
    report: string;
  };
  accountStatus: Record<string, string>;
  accountRole: Record<string, string>;
  accountCategory: Record<string, string>;
  postStatus: Record<string, string>;
  accountCard: string;
  stats: {
    format: string;
  };
  limits: {
    format: string;
    formatParser: string;
    formatStatus: string;
  };
  notifications: {
    restriction: string;
  };
  conversations: {
    addAccount: Record<string, string>;
    addKeywords: Record<string, string>;
    addTemplates: Record<string, string>;
    limits: Record<string, string>;
  };
}

let cachedLang: Lang | null = null;

export function loadLang(): Lang {
  if (cachedLang) return cachedLang;
  const filePath = join(__dirname, '../../../lang/ru.yml');
  const raw = readFileSync(filePath, 'utf8');
  cachedLang = yaml.load(raw) as Lang;
  return cachedLang;
}

export const lang: Lang = loadLang();

export function t(
  template: string,
  vars: Record<string, string | number> = {},
): string {
  return Object.entries(vars).reduce(
    (str, [key, val]) => str.replace(new RegExp(`%${key}%`, 'g'), String(val)),
    template,
  );
}

export function clearLangCache(): void {
  cachedLang = null;
}
