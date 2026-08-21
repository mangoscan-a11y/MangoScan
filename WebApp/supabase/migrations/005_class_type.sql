-- MangoScan Schema
-- Migration 005: Extend class_type with the new classification dimensions
-- Run this alone — Postgres will not let a newly added enum value be used
-- in the same transaction that adds it, so 006 must run as a separate call.

alter type class_type add value if not exists 'bruise';
alter type class_type add value if not exists 'color';
alter type class_type add value if not exists 'size';
