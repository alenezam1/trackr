import type { ConnectionStatus, ProviderMode, SearchIntent } from '../models.js';

export interface DiscoveredJob {
  sourceId: string;
  sourceJobId: string | null;
  title: string;
  employer: string | null;
  employerId?: number | null;
  location: string | null;
  boardUrl: string | null;
  employerUrl: string | null;
  applyUrl: string | null;
  applyUrlKind: 'EMPLOYER_ATS' | 'EMPLOYER_SITE' | 'BOARD' | 'UNKNOWN';
  postedAt: string | null;
  deadline: string | null;
  salaryText: string | null;
  descriptionText: string | null;
  descriptionComplete: boolean;
  extractionMethod: string;
  accessMode: ProviderMode;
  legalEmployerHint?: string | null;
  query?: string | null;
  isDemo?: boolean;
  listingState?: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  /** UK (default) or a Gulf market (UAE / QATAR / SAUDI). */
  market?: 'UK' | 'UAE' | 'QATAR' | 'SAUDI';
  /** Key sentences copied verbatim by OpenAI web search after it opened the posting (used only if the app can't read the page). */
  aiReadText?: string | null;
}

export interface SourceAccessResult {
  status: ConnectionStatus;
  message: string;
  recommendedAction?: string;
}

export interface DiscoveryPage {
  jobs: DiscoveredJob[];
  linksFound: number;
  queries: string[];
  errors: string[];
  nextCursor?: string | null;
}

export interface SearchLink { label: string; url: string }

export interface JobSourceAdapter {
  id: string;
  displayName: string;
  sourceHomepage: string;
  mode: ProviderMode;
  kind: 'BOARD' | 'ATS' | 'API' | 'SEARCH' | 'MANUAL';
  description: string;
  verifyAccess(): Promise<SourceAccessResult>;
  discover?(input: SearchIntent, ctx: DiscoveryContext): Promise<DiscoveryPage>;
  searchLinks?(input: SearchIntent): SearchLink[];
}

export interface DiscoveryContext {
  runId: number | null;
  shouldStop: () => boolean;
  budget: { queriesLeft: number };
  /** Scan console line (stage: SEARCH / FILTER / AI / SOURCE …). */
  log: (stage: 'PLAN' | 'SEARCH' | 'FILTER' | 'OPEN' | 'AI' | 'CAREERS' | 'SKIP' | 'GRADE' | 'SOURCE' | 'SUMMARY' | 'ERROR', msg: string, data?: Record<string, unknown>) => void;
}
