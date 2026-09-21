import { createServerFn } from '@tanstack/react-start';
import axios from 'axios';

export const FEEDBACK_TYPES = [
  'bug',
  'data',
  'change',
  'feature',
  'question',
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'done', 'wont_do'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

type ContextValue = string | number | boolean;

export type FeedbackSubmission = {
  type: FeedbackType;
  description: string;
  contact: string;
  page: string;
  context: Record<string, ContextValue>;
  userAgent: string;
  clientId: string;
  // hidden honeypot field — real people leave it empty
  website: string;
};

export type FeedbackItem = {
  ref: string;
  type: FeedbackType;
  description: string;
  contact: string;
  page: string;
  context: Record<string, ContextValue>;
  userAgent: string;
  env: string;
  status: FeedbackStatus;
  notes: string;
  notified: boolean;
  createdAt: string;
  updatedAt: string;
};

type SubmitResponse = { ok: boolean; ref?: string; error?: string };
type ListResponse = { ok: boolean; items?: FeedbackItem[]; error?: string };
type UpdateResponse = { ok: boolean; item?: FeedbackItem; error?: string };

// The browser talks to these server functions; only the UI's server talks to
// main-services. The admin key is forwarded as a header and checked there.
export const submitFeedback = createServerFn({ method: 'POST' })
  .inputValidator((data: FeedbackSubmission) => data)
  .handler(async ({ data }): Promise<SubmitResponse> => {
    try {
      const resp = await axios.post<SubmitResponse>(
        `${process.env.MAIN_SERVICES_URL!}/feedback`,
        data,
        { timeout: 15000 },
      );
      return resp.data;
    } catch (error) {
      console.error('submitFeedback error:', error);
      return {
        ok: false,
        error:
          'Could not send your feedback right now. Please try again shortly.',
      };
    }
  });

export const listFeedback = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      adminKey: string;
      status?: FeedbackStatus;
      type?: FeedbackType;
    }) => data,
  )
  .handler(async ({ data }): Promise<ListResponse> => {
    try {
      const resp = await axios.get<ListResponse>(
        `${process.env.MAIN_SERVICES_URL!}/feedback`,
        {
          headers: { 'x-admin-key': data.adminKey },
          params: { status: data.status, type: data.type, limit: 200 },
          timeout: 15000,
        },
      );
      return resp.data;
    } catch (error) {
      console.error('listFeedback error:', error);
      return { ok: false, error: 'Could not reach the feedback service.' };
    }
  });

export const updateFeedback = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      adminKey: string;
      ref: string;
      status?: FeedbackStatus;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<UpdateResponse> => {
    try {
      const resp = await axios.patch<UpdateResponse>(
        `${process.env.MAIN_SERVICES_URL!}/feedback/${encodeURIComponent(data.ref)}`,
        { status: data.status, notes: data.notes },
        { headers: { 'x-admin-key': data.adminKey }, timeout: 15000 },
      );
      return resp.data;
    } catch (error) {
      console.error('updateFeedback error:', error);
      return { ok: false, error: 'Could not reach the feedback service.' };
    }
  });
