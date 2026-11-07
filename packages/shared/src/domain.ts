import { z } from 'zod';

export const ASSIGNMENT_STATUSES = [
  'todo',
  'in_progress',
  'done',
  'submitted',
  'cancelled',
] as const;
export const AssignmentStatus = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

export const ASSIGNMENT_TYPES = [
  'assignment',
  'quiz',
  'exam',
  'project',
  'lab',
  'reading',
  'presentation',
  'other',
] as const;
export const AssignmentType = z.enum(ASSIGNMENT_TYPES);
export type AssignmentType = z.infer<typeof AssignmentType>;

/** File extensions without the dot, lower case: "pdf", "docx". */
const FileExt = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^\./, ''))
  .pipe(z.string().regex(/^[a-z0-9]{1,10}$/));

/**
 * One deadline pulled out of a syllabus by the LLM (PRD M3). Nothing here is trusted until the
 * student confirms it on the review screen.
 */
export const ExtractedAssignment = z.object({
  courseCode: z.string().trim().max(40),
  courseName: z.string().trim().max(200).optional(),
  title: z.string().trim().min(1).max(300),
  /** ISO 8601 with offset. Null when the syllabus gives no usable date. */
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  /** True when the syllabus gave a date but no time and we assumed one. */
  dueTimeAssumed: z.boolean().default(false),
  /** Plain-language note on any timezone or time assumption, shown on the review screen. */
  assumption: z.string().max(300).optional(),
  weightPct: z.number().min(0).max(100).nullable(),
  type: AssignmentType.default('assignment'),
  allowedFileTypes: z.array(FileExt).max(20).default([]),
  notes: z.string().max(1000).optional(),
  /** Model's confidence in this row, 0–1. Below LOW_CONFIDENCE it is flagged for review. */
  confidence: z.number().min(0).max(1),
  /** Short quote from the syllabus that supports the date. */
  evidence: z.string().max(500).optional(),
});
export type ExtractedAssignment = z.infer<typeof ExtractedAssignment>;

export const LOW_CONFIDENCE = 0.7;

/**
 * What the LLM returns for one deadline. Times are LOCAL wall-clock ("2026-10-16T17:00"); code
 * converts them with the student's timezone (see time.ts), because models get DST offsets wrong.
 */
export const LlmAssignment = z.object({
  courseCode: z.string(),
  courseName: z.string().nullable(),
  title: z.string(),
  dueLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'dueLocal must be YYYY-MM-DDTHH:mm')
    .nullable(),
  dueTimeAssumed: z.boolean(),
  assumption: z.string().nullable(),
  weightPct: z.number().min(0).max(100).nullable(),
  type: AssignmentType,
  allowedFileTypes: z.array(z.string()),
  notes: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().nullable(),
});
export type LlmAssignment = z.infer<typeof LlmAssignment>;

export const LlmExtraction = z.object({
  assignments: z.array(LlmAssignment),
  warnings: z.array(z.string()),
});
export type LlmExtraction = z.infer<typeof LlmExtraction>;

/**
 * Plain JSON Schema for Gemini structured output (OpenAI-compatible endpoint). Kept by hand and
 * small: nullable fields use a type array, which Gemini accepts (verified 2026-11-07).
 */
export const LLM_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  required: ['assignments', 'warnings'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'courseCode',
          'courseName',
          'title',
          'dueLocal',
          'dueTimeAssumed',
          'assumption',
          'weightPct',
          'type',
          'allowedFileTypes',
          'notes',
          'confidence',
          'evidence',
        ],
        properties: {
          courseCode: { type: 'string', description: 'Course code like "DATA 210"' },
          courseName: { type: ['string', 'null'] },
          title: { type: 'string' },
          dueLocal: {
            type: ['string', 'null'],
            description: 'Local time YYYY-MM-DDTHH:mm, or null if no usable date',
          },
          dueTimeAssumed: {
            type: 'boolean',
            description: 'True if the time was not stated and you used the default',
          },
          assumption: {
            type: ['string', 'null'],
            description: 'Plain-language note on any assumption',
          },
          weightPct: {
            type: ['number', 'null'],
            description: 'Percent of the final grade for THIS item',
          },
          type: { type: 'string', enum: [...ASSIGNMENT_TYPES] },
          allowedFileTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Extensions like "pdf"',
          },
          notes: { type: ['string', 'null'] },
          confidence: { type: 'number', description: '0 to 1' },
          evidence: {
            type: ['string', 'null'],
            description: 'Short exact quote supporting the date',
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const ExtractionResult = z.object({
  assignments: z.array(ExtractedAssignment).max(200),
  /** Anything the model could not place, for the student to look at. */
  warnings: z.array(z.string().max(500)).max(50).default([]),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;
