import { tipc } from '@egoist/tipc/main';
import {
  clearAllBrowserData,
  clearBrowserCache,
  clearDomainData,
  listBrowserData,
  logoutLoginAccount,
  removeLoginAccount,
} from '../services/browser/browser-data-service.js';
import {
  deleteSiteKnowledge,
  listSiteKnowledge,
  readSiteKnowledge,
} from '../services/browser/site-knowledge-service.js';

const t = tipc.create();

export const browserDataRouter = {
  listBrowserData: t.procedure.action(async () => listBrowserData()),

  clearBrowserDomainData: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => clearDomainData(input.domain)),

  logoutLoginAccount: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => logoutLoginAccount(input.domain)),

  removeLoginAccount: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => removeLoginAccount(input.domain)),

  listSiteKnowledge: t.procedure.action(async () => listSiteKnowledge()),

  readSiteKnowledge: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => readSiteKnowledge(input.domain)),

  deleteSiteKnowledge: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => deleteSiteKnowledge(input.domain)),

  clearBrowserCache: t.procedure.action(async () => clearBrowserCache()),

  clearAllBrowserData: t.procedure.action(async () => clearAllBrowserData()),
};
