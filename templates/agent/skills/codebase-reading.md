# Codebase Reading

## Purpose

Read a project, identify the important files, explain the architecture, and avoid guessing when evidence is missing.

## Required Capabilities

- filesystem.read
- filesystem.search

## Preferred Workflow

1. Inspect the top-level directory.
2. Find package, build, and test files.
3. Search for entry points, routes, commands, and domain terms.
4. Read only the files needed to answer the task.
5. Summarize structure, data flow, risks, and verification commands.

## Fallback Workflow

If filesystem.search is unavailable, ask the user for a file tree or use a Python text-search fallback if code execution is available.

If filesystem.read is unavailable, ask the user to upload the relevant files or paste excerpts.
