# Agent Instructions

# Absolute Maxims

- Define types only inline if the type is used multiple types, otherwise never define types at the top of the file.
- Never typecast unless there's a verified bug in the types you are working with.
- When making fetch requests validate and parse the response using Zod at runtime. Do not `as` the response and do not catch and just log. Instead, if the response is invalid, throw an error with a clear message about what was expected and what was received.
- Ignore and _never_ modify files that are in `**/_/**` directories, they are scratchnotes for me.
- "Temporary patch", "Backward compatibility" are undesired and should be avoided unless explicitly requested.
- do not confidently prescribe infrastructure/tooling fixes from pattern-matching. Verify the tool’s actual contract first, and distinguish “known fix” from “candidate workaround”,
- unless impossible, do not answer with "likely", "probably", "might", "if", "could be", or other speculation. Instead, try to answer concretely from verifiable facts, and if verification is not possible, say "I cannot verify this" or "I do not have enough information to answer this" rather than speculating,
- Avoid shortcuts, “for now” fixes, or narrow changes that make one task pass while degrading business logic, architecture, or behavior elsewhere. Prefer solutions that keep the whole system working coherently over fixes that merely turn one check green,
- Unless explicitly told otherwise, assume all changes are production-bound,
- For operational, infrastructure, deployment, CI/CD, migration, or configuration questions, separate verified facts, assumptions, and recommendations. Cite the exact source checked, such as docs URL, file path, command output, or CI log.
- When the repo already contains the relevant generated types, declarations, config, or source files, inspect them directly before answering. Do not say "if", "might", or speculate about declaration kind, merge behavior, or available symbols when the answer is locally verifiable.
- If discussing TypeScript declaration merging or global type behavior, first read the actual generated `.d.ts` files in the repo and answer from those facts.
- When asked to integrate a named third-party product/API, do not substitute a nearby existing integration unless explicitly approved. If the requested API differs from an existing capability, stop before editing and report:
  - requested API surface
  - existing local capability found
  - whether they are equivalent
  - proposed implementation path
  - Examples:
    - ElevenLabs Speech Engine is not the same as ElevenLabs Text to Speech.
    - Realtime/WebSocket/WebRTC APIs are not equivalent to batch TTS/STT pipelines.

## Style

- Make minimal, focused changes.
- Do not reformat unrelated files.
- Keep explanations concise and include exact paths changed.

## File Safety

- Always `read_file` immediately before editing any file; never rely on file snapshots attached earlier in the conversation.
- Never use shell redirects (`>`, `>>`, `tee`, `printf > file`) or `cat <<EOF` to modify existing files. Use the `edit_file` tool only. If `edit_file` errors, retry `edit_file` — do not fall back to shell writes.
- Prefer `edit_file` mode `edit` over `overwrite`. Only use `overwrite` after re-reading the file in the same turn.
- If you create a backup file, do not delete it in the same turn — leave it until the user confirms the new state.
- Never revert, overwrite, or remove user changes just because you did not make them. Preserve existing user edits and build on top of the current file state unless the user explicitly asks for a revert or replacement.
