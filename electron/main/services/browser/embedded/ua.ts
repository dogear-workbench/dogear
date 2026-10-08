import { app, type Session } from 'electron';

export function buildEmbeddedBrowserUserAgent(defaultUserAgent: string, dogearVersion: string): string {
  const base = defaultUserAgent
    .replace(/\s+Electron\/[^\s]+/gi, '')
    .replace(/\s+Dogear\/[^\s]+/gi, '')
    .trim();
  return `${base} Dogear/${dogearVersion}`;
}

export function applyEmbeddedUserAgent(session: Session): void {
  session.setUserAgent(buildEmbeddedBrowserUserAgent(session.getUserAgent(), app.getVersion()));
}
