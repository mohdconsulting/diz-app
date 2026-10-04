-- Migration 002: leverantörens svar på rapporterat problem
alter table public.jobs add column if not exists provider_response text;
alter table public.jobs add column if not exists provider_response_at bigint;
