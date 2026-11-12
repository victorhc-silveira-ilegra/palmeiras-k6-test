export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "pt-br-language": (parsed) => {
          const { subject, raw } = parsed;
          if (!subject || (raw && raw.includes("[skip-cd]"))) {
            return [true];
          }
          const forbiddenEnglishTerms = [
            /\badd\b/i,
            /\badded\b/i,
            /\badding\b/i,
            /\bupdate\b/i,
            /\bupdated\b/i,
            /\bupdating\b/i,
            /\bfix\b/i,
            /\bfixed\b/i,
            /\bfixing\b/i,
            /\bremove\b/i,
            /\bremoved\b/i,
            /\bchange\b/i,
            /\bchanged\b/i,
            /\bimplement\b/i,
            /\bimplemented\b/i,
            /\btelemetry\b/i,
            /\bwith\b/i,
            /\band\b/i,
          ];
          for (const pattern of forbiddenEnglishTerms) {
            if (pattern.test(subject)) {
              return [
                false,
                `Mensagem em ingles detectada no subject: "${subject}". Todas as mensagens de commit devem ser escritas exclusivamente em Portugues do Brasil (PT-BR). Leia .agents/rules/git-workflow.md`,
              ];
            }
          }
          return [true];
        },
      },
    },
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "subject-case": [2, "never", ["pascal-case", "upper-case"]],
    "pt-br-language": [2, "always"],
  },
};
