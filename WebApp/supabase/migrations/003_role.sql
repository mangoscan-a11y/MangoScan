-- Migration 003: Add role column to profiles (single general admin type)

create type user_role as enum ('admin');

alter table profiles
  add column role user_role not null default 'admin';
