import { tipc } from '@egoist/tipc/main';
import {
  clearAllBrowserData,
  clearBrowserCache,
  clearDomainData,
  listBrowserData,
  logoutDomain,
} from '../services/browser/browser-data-service.js';

const t = tipc.create();

export const browserDataRouter = {
  listBrowserData: t.procedure.action(async () => listBrowserData()),

  logoutBrowserDomain: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => logoutDomain(input.domain)),

  clearBrowserDomainData: t.procedure
    .input<{ domain: string }>()
    .action(async ({ input }) => clearDomainData(input.domain)),

  clearBrowserCache: t.procedure.action(async () => clearBrowserCache()),

  clearAllBrowserData: t.procedure.action(async () => clearAllBrowserData()),
};
