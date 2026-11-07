import { z } from 'zod';

export const ASSIGNMENT_STATUSES = ['todo', 'in_progress', 'done', 'submitted'] as const;
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

export const ExtractionResult = z.object({
  assignments: z.array(ExtractedAssignment).max(200),
  /** Anything the model could not place, for the student to look at. */
  warnings: z.array(z.string().max(500)).max(50).default([]),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;
