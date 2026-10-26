import {
  TEMPLATE_FIELD_KEY_MAX_LENGTH,
  TEMPLATE_FIELD_LABEL_MAX_LENGTH,
} from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { he } from '../../../i18n/he';
import {
  boxCardId,
  boxFieldId,
  type BoxProp,
  type EditorErrors,
  positionFieldId,
} from './editor-check';
import { boxTitle, cardControls, conditionTargets } from './editor-rules';
import {
  addPosition,
  type EditorBox,
  type EditorPosition,
  type EditorState,
  POSITION_NUMBERS,
  removeBox,
  removePosition,
  renameKey,
  updateBox,
  updatePosition,
} from './editor-state';
import { ConditionFields } from './ConditionFields';
import { ChoicesField, DateLimitsField, MaxLengthField } from './LimitFields';

const text = he.templates.editor;

interface BoxCardProps {
  box: EditorBox;
  state: EditorState;
  errors: EditorErrors;
  inFooter: ReadonlySet<string>;
  selected: boolean;
  disabled: boolean;
  onState: (update: (state: EditorState) => EditorState) => void;
  onSelect: () => void;
}

function PositionRow({
  position,
  number,
  box,
  state,
  errors,
  inFooter,
  disabled,
  onState,
}: {
  position: EditorPosition;
  number: number;
  box: EditorBox;
  state: EditorState;
  errors: EditorErrors;
  inFooter: boolean;
  disabled: boolean;
  onState: BoxCardProps['onState'];
}) {
  const own = errors.positions[position.uid] ?? {};
  const controls = cardControls(box);
  return (
    <Box
      component="li"
      sx={{
        listStyle: 'none',
        borderTop: 1,
        borderColor: 'divider',
        pt: 1.5,
        display: 'grid',
        gap: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" component="h5" sx={{ flex: 1 }}>
          {text.position(number)}
        </Typography>
        <IconButton
          size="small"
          aria-label={text.removePosition(number)}
          disabled={disabled}
          onClick={() => onState((current) => removePosition(current, position.uid))}
        >
          <DeleteOutlined fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        {POSITION_NUMBERS.map((prop) => (
          <TextField
            key={prop}
            id={positionFieldId(position.uid, prop)}
            size="small"
            label={text.numbers[prop]}
            value={position[prop]}
            disabled={disabled}
            error={Boolean(own[prop])}
            helperText={own[prop]}
            onChange={(event) =>
              onState((current) =>
                updatePosition(current, position.uid, { [prop]: event.target.value }),
              )
            }
            slotProps={{ htmlInput: { inputMode: 'decimal', dir: 'ltr' } }}
            sx={{ width: prop === 'page' ? 64 : 84 }}
          />
        ))}
      </Box>
      {own.general && (
        <FormHelperText error id={positionFieldId(position.uid, 'general')} tabIndex={-1}>
          {own.general}
        </FormHelperText>
      )}
      {inFooter && (
        <Alert severity="warning" role="note" sx={{ py: 0 }}>
          {text.inFooter}
        </Alert>
      )}
      {controls.conditionPerPosition && (
        <ConditionFields
          id={positionFieldId(position.uid, 'showWhen')}
          value={position.showWhen}
          targets={conditionTargets(state, box.uid)}
          disabled={disabled}
          error={own.showWhen}
          onChange={(showWhen) =>
            onState((current) => updatePosition(current, position.uid, { showWhen }))
          }
        />
      )}
    </Box>
  );
}

/**
 * One box (all positions of one key, FR-TPL-10): its settings, then its positions in points.
 * Only the settings its type allows are shown.
 */
export function BoxCard({
  box,
  state,
  errors,
  inFooter,
  selected,
  disabled,
  onState,
  onSelect,
}: BoxCardProps) {
  const controls = cardControls(box);
  const own: Partial<Record<BoxProp, string>> = errors.boxes[box.uid] ?? {};
  const title = boxTitle(box);
  const positions = state.positions.filter(({ boxUid }) => boxUid === box.uid);
  const change = (next: Parameters<typeof updateBox>[2]) =>
    onState((current) => updateBox(current, box.uid, next));

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={boxCardId(box.uid)}
      onFocusCapture={onSelect}
      sx={{
        p: 2.5,
        display: 'grid',
        gap: 2,
        borderColor: selected ? 'primary.main' : undefined,
        borderWidth: selected ? 2 : 1,
        // Keeps the content in place when the border gets thicker.
        m: selected ? 0 : '1px',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography
          id={boxCardId(box.uid)}
          variant="h3"
          tabIndex={-1}
          sx={{ flex: 1, outline: 'none' }}
        >
          {title}
        </Typography>
        <IconButton
          aria-label={text.removeBox(title)}
          disabled={disabled}
          onClick={() => onState((current) => removeBox(current, box.uid))}
        >
          <DeleteOutlined />
        </IconButton>
      </Box>
      {state.mixedKeys.includes(box.key) && (
        <Alert severity="info" role="note">
          {text.mixedSettings}
        </Alert>
      )}
      {own.general && (
        <FormHelperText error id={boxFieldId(box.uid, 'general')} tabIndex={-1}>
          {own.general}
        </FormHelperText>
      )}
      {(controls.keyEditable || controls.fillModes.length > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {controls.keyEditable && (
            <TextField
              id={boxFieldId(box.uid, 'key')}
              size="small"
              label={text.key}
              value={box.key}
              disabled={disabled}
              error={Boolean(own.key)}
              helperText={own.key ?? text.keyHint}
              onChange={(event) =>
                onState((current) => renameKey(current, box.uid, event.target.value))
              }
              slotProps={{
                htmlInput: {
                  dir: 'ltr',
                  maxLength: TEMPLATE_FIELD_KEY_MAX_LENGTH,
                  spellCheck: false,
                },
              }}
              sx={{ width: 280 }}
            />
          )}
          {controls.fillModes.length > 0 && (
            <TextField
              id={boxFieldId(box.uid, 'fillMode')}
              select
              size="small"
              label={text.fillMode}
              value={box.fillMode ?? ''}
              disabled={disabled}
              error={Boolean(own.fillMode)}
              helperText={own.fillMode}
              onChange={(event) => {
                const mode = controls.fillModes.find((item) => item === event.target.value);
                if (mode) change({ fillMode: mode });
              }}
              sx={{ minWidth: 240 }}
            >
              {controls.fillModes.map((mode) => (
                <MenuItem key={mode} value={mode}>
                  {he.templates.fillModes[mode]}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      )}
      {controls.label && (
        <TextField
          id={boxFieldId(box.uid, 'label')}
          size="small"
          label={text.label}
          value={box.label}
          disabled={disabled}
          required={controls.labelRequired}
          error={Boolean(own.label)}
          helperText={own.label ?? (controls.labelRequired ? text.labelRequiredHint : undefined)}
          onChange={(event) => change({ label: event.target.value })}
          slotProps={{ htmlInput: { maxLength: TEMPLATE_FIELD_LABEL_MAX_LENGTH } }}
          fullWidth
        />
      )}
      {(controls.required || controls.approval) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 3 }}>
          {controls.required && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={box.isRequired}
                  disabled={disabled}
                  onChange={(event) => change({ isRequired: event.target.checked })}
                />
              }
              label={text.required}
            />
          )}
          {controls.approval && (
            <FormControlLabel
              control={
                <Checkbox
                  id={boxFieldId(box.uid, 'needsApproval')}
                  checked={box.needsApproval}
                  disabled={disabled}
                  onChange={(event) => change({ needsApproval: event.target.checked })}
                />
              }
              label={text.needsApproval}
            />
          )}
        </Box>
      )}
      {controls.maxLength !== null && (
        <MaxLengthField
          box={box}
          max={controls.maxLength}
          disabled={disabled}
          errors={own}
          onChange={change}
        />
      )}
      {controls.choices && (
        <ChoicesField box={box} disabled={disabled} errors={own} onChange={change} />
      )}
      {controls.dates && (
        <DateLimitsField box={box} disabled={disabled} errors={own} onChange={change} />
      )}
      {!controls.conditionPerPosition && (
        <ConditionFields
          id={boxFieldId(box.uid, 'showWhen')}
          value={box.showWhen}
          targets={conditionTargets(state, box.uid)}
          disabled={disabled}
          error={own.showWhen}
          onChange={(showWhen) => change({ showWhen })}
        />
      )}
      <Box>
        <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 'medium' }}>
          {text.positionsTitle}
        </Typography>
        <Box component="ol" sx={{ m: 0, p: 0, display: 'grid', gap: 1.5, mt: 1 }}>
          {positions.map((position, index) => (
            <PositionRow
              key={position.uid}
              position={position}
              number={index + 1}
              box={box}
              state={state}
              errors={errors}
              inFooter={inFooter.has(position.uid)}
              disabled={disabled}
              onState={onState}
            />
          ))}
        </Box>
        <Button
          size="small"
          startIcon={<AddOutlined />}
          disabled={disabled}
          onClick={() => onState((current) => addPosition(current, box.uid))}
          sx={{ mt: 1.5 }}
        >
          {text.addPosition}
        </Button>
      </Box>
    </Paper>
  );
}
