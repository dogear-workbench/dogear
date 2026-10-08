import { tipc } from '@egoist/tipc/main';
import { deleteSiteKnowledge, listSiteKnowledge, readSiteKnowledge } from '../services/browser/site-knowledge-service.js';
import { listBlocked, removeBlockedDomain } from '../services/browser/browser-blocklist-service.js';

const t = tipc.create();

export const browserDataRouter = {
  listSiteKnowledge: t.procedure.action(async () => listSiteKnowledge()),

  readSiteKnowledge: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => readSiteKnowledge(input.domain)),

  deleteSiteKnowledge: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => deleteSiteKnowledge(input.domain)),

  listBrowserBlocklist: t.procedure.action(async () => listBlocked()),

  unblockBrowserDomain: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => removeBlockedDomain(input.domain)),
};
