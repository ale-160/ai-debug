# Contributing

Thanks for your interest in 蛛网 · AI Debug! Contributions of any kind are welcome.

## Quick contribute

### Report issues

- Open an issue on [GitHub Issues](https://github.com/ale-160/ai-debug/issues)
- Please include: reproduction steps, expected behavior, actual behavior, browser/OS version
- Attach screenshots or console logs if available

### Submit a Pull Request

1. Fork the repo and clone it locally
2. Create a branch: `git checkout -b feat/your-feature` or `fix/your-bugfix`
3. Develop inside the `apps/web` directory
4. Before submitting, make sure:
   - `pnpm --filter @ai-debug/web exec tsc --noEmit` passes with no errors
   - `pnpm --filter @ai-debug/web lint` shows no major warnings
5. Use a clear commit message (English or Chinese is fine)
6. Open a PR describing what and why

## Basic conventions

### Code style

- TypeScript first, avoid `any`
- New functions should have a short comment describing their purpose
- React components use function + Hooks style
- State management goes through the Zustand store — don't read localStorage directly (except in the storage layer)

### Commit messages

No strict format, but keep it clear:

- `feat: add xxx feature`
- `fix: fix xxx issue`
- `docs: update docs`
- `refactor: refactor xxx`

### Branch naming

- Feature: `feat/xxx`
- Fix: `fix/xxx`
- Docs: `docs/xxx`

## Dev environment

- Node.js ≥ 22
- pnpm ≥ 9

```bash
pnpm install
cd apps/web
pnpm dev
```

## Project layout

See the "Project structure" section in [README.en.md](./README.en.md). Core code lives in `apps/web/src/`, split into `components/` (UI) and `lib/` (business logic).

## Code of conduct

- Be kind and respectful
- Be patient with newcomers
- Focus on the problem, not the person

Thanks again for contributing!
