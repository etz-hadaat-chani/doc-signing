import { ROUND_NAME_MAX_LENGTH } from '@doc-signing/shared';
import { he } from '../../../i18n/he';
import type { StepProblem } from './wizard-state';

const problems = he.newRound.problems;

export function problemText(problem: StepProblem): string {
  return problem === 'nameTooLong'
    ? problems.nameTooLong(ROUND_NAME_MAX_LENGTH)
    : problems[problem];
}
