import React from 'react';
import { api } from '../api';
import { AppCtx } from '../App';
import { Empty, ErrorBox, Spinner, useAsync, Badge } from '../components/ui';
import { JobCard } from '../components/JobCard';

const REVIEW_GROUPS: Array<[string, string, string]> = [
  ['', 'All', ''],
  ['SPONSOR_AMBIGUOUS', 'Confirm employer entity', 'Confirm the legal employer on the Sponsors page or in the job’s “Sponsor match” tab.'],
  ['ACTUAL_EMPLOYER_UNKNOWN', 'Agency / employer unknown', 'Ask the recruiter which legal entity employs the role.'],
  ['FULL_JD_NOT_READ', 'Read JD', 'Open the listing and paste the full description.'],
  ['OTHER_MANDATORY_VETTING', 'Clarify vetting', 'Check whether SC/DV/CTC is mandatory.'],
  ['NO_FUTURE_SPONSORSHIP', 'Future sponsorship', 'Role says no sponsorship and outlasts your visa.'],
  ['CONTRACT_DURATION_UNKNOWN', 'Verify programme length', 'Check contract/programme length.'],
  ['PROGRAMME_EXCEEDS_WORK_PERMISSION', 'Duration vs visa', 'Programme may outlast your permission.'],
  ['GRADUATION_COHORT_INELIGIBLE', 'Check cohort', 'Set your graduation year in Settings.'],
  ['LOCATION_OUT_OF_SCOPE', 'Check location', 'Confirm the role can be done from the UK.'],
  ['OUT_OF_SCOPE_ROLE', 'Check category', 'Category could not be determined.'],
];
const REJECT_FILTERS: Array<[string, string]> = [
  ['', 'All'], ['SC_REQUIRED', 'SC'], ['DV_REQUIRED', 'DV'], ['CTC_REQUIRED', 'CTC'], ['REQUIRES_BRITISH_CITIZENSHIP', 'Citizenship'],
  ['GRADUATE_VISA_EXPLICITLY_DISALLOWED', 'Visa ban'], ['PERMANENT_WORK_AUTHORISATION_REQUIRED', 'Permanent RTW'], ['NO_FUTURE_SPONSORSHIP', 'No future sponsorship'],
  ['PROGRAMME_EXCEEDS_WORK_PERMISSION', 'Duration'], ['EXPERIENCE_EXCEEDS_ENTRY_LEVEL', 'Experience'], ['SENIOR_JOB', 'Senior'], ['SPONSOR_NOT_FOUND', 'Sponsor not found'],
  ['CURRENT_STUDENT_REQUIRED', 'Students only'], ['UNPAID_ROLE', 'Unpaid'], ['LOCATION_OUT_OF_SCOPE', 'Location'], ['OUT_OF_SCOPE_ROLE', 'Out of scope'],
];

function Queue({ statuses, filters, title, intro, tick }: { statuses: string; filters: Array<[string, string, string?]>; title: string; intro: string; tick: number }) {
  const { openJob, toast } = React.useContext(AppCtx);
  const [reason, setReason] = React.useState('');
  const [limit, setLimit] = React.useState(60);
  const { data, error, loading, reload } = useAsync(() => api(`/api/jobs?statuses=${statuses}&reason=${reason}&limit=${limit}&sort=recent`), [reason, limit, tick]);
  const hint = filters.find((f) => f[0] === reason)?.[2];
  return (
    <div className="space-y-4">
      <div className="h1">{title}</div>
      <div className="text-sm text-mute">{intro}</div>
      <div className="flex flex-wrap gap-1.5">{filters.map(([k, l]) => <button key={k} className={`chip ${reason === k ? 'chip-on' : ''}`} onClick={() => setReason(k)}>{l}</button>)}</div>
      {hint && <div className="text-xs text-info">Action: {hint}</div>}
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data?.jobs?.length ? (
        <>
          <div className="text-sm text-mute">{data.total} jobs</div>
          <div className="grid xl:grid-cols-2 gap-3">{data.jobs.map((j: any) => <JobCard key={j.id} job={j} onOpen={openJob} onChanged={(m) => { toast(m); reload(); }} />)}</div>
          {data.total > limit && <button className="btn" onClick={() => setLimit(limit + 60)}>Load more</button>}
        </>
      ) : <Empty title="Nothing here" />}
    </div>
  );
}

export function ReviewPage({ tick }: { tick: number }) {
  const { go, status } = React.useContext(AppCtx);
  return (
    <>
      {status?.employers?.proposed > 0 && <div className="card p-3 mb-4 text-sm border-info/40"><Badge tone="info">{status.employers.proposed} proposed employer mappings</Badge> Most review items clear once you confirm employer entities. <button className="underline text-accent" onClick={() => go('sponsors')}>Confirm on Sponsors & Employers</button></div>}
      <Queue tick={tick} statuses="NEEDS_REVIEW" filters={REVIEW_GROUPS} title="Needs Review" intro="Uncertain employers, partial descriptions and unresolved eligibility facts. Nothing here is shown as verified." />
    </>
  );
}
export function RejectedPage({ tick }: { tick: number }) {
  return <Queue tick={tick} statuses="EXCLUDED,STALE" filters={REJECT_FILTERS} title="Rejected" intro="Hard-excluded and closed jobs, each with the exact rule and quoted JD sentence. Open a job and use “Dispute / mark for review” if a source error caused an exclusion." />;
}
