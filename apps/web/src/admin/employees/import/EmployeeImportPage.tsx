import type { ImportCommitResult, ImportPreview } from '@doc-signing/shared';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { he } from '../../../i18n/he';
import { DoneStep } from './DoneStep';
import { PreviewStep } from './PreviewStep';
import { UploadStep } from './UploadStep';

type WizardStep =
  | { kind: 'upload' }
  | { kind: 'preview'; preview: ImportPreview; receivedAt: Date }
  | { kind: 'done'; result: ImportCommitResult };

const STEP_INDEX = { upload: 0, preview: 1, done: 2 } as const;

/**
 * Excel import (A8): upload → check report → confirm → done. The step and the report are kept in
 * this component only: nothing in the address or in browser storage.
 */
export function EmployeeImportPage() {
  const [step, setStep] = useState<WizardStep>({ kind: 'upload' });
  const startOver = () => setStep({ kind: 'upload' });

  return (
    <>
      <Typography variant="h1" sx={{ mb: 3 }}>
        {he.nav.employeeImport}
      </Typography>
      <Stepper
        activeStep={STEP_INDEX[step.kind]}
        aria-label={he.employeeImport.stepsLabel}
        sx={{ mb: 4, maxWidth: 640 }}
      >
        {he.employeeImport.steps.map((label, index) => (
          <Step key={label} completed={index < STEP_INDEX[step.kind] || step.kind === 'done'}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {step.kind === 'upload' && (
        <UploadStep
          onChecked={(preview) => setStep({ kind: 'preview', preview, receivedAt: new Date() })}
        />
      )}
      {step.kind === 'preview' && (
        <PreviewStep
          preview={step.preview}
          receivedAt={step.receivedAt}
          onStartOver={startOver}
          onDone={(result) => setStep({ kind: 'done', result })}
        />
      )}
      {step.kind === 'done' && <DoneStep result={step.result} onAnother={startOver} />}
    </>
  );
}
