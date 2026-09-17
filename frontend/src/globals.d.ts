// Next.js declara `*.module.css` em next-env.d.ts, mas não CSS puro
// (globals.css, importado por side-effect em app/layout.tsx) — o
// TypeScript 6 passou a exigir declaração de tipo mesmo pra imports só de
// efeito colateral, onde antes não reclamava disso.
declare module "*.css";
