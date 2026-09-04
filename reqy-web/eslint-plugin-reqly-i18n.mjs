/**
 * eslint-plugin-reqly-i18n — règle maison anti-hardcodage (passe de
 * dé-vibecodage 2026-09-03).
 *
 * Constat d'audit : fr.json/en.json sont parfaitement synchronisés (test de
 * parity) mais des centaines de chaînes UI restent écrites en dur dans le
 * code (runner, workspaces, sdks, toasts) — chaque session de génération
 * contournait le système sans le vérifier. Cette règle rend la dérive
 * impossible : toute string littérale visible dans le JSX doit passer par
 * t("…").
 *
 * Périmètre volontairement limité (warn, pas error) : on veut bloquer la
 * NOUVELLE dérive sans forcer la migration des centaines d'occurrences
 * historiques d'un coup. Les fichiers de test, les modules backend (API
 * routes, lib) et les constantes techniques sont exclus.
 */
const noHardcodedJsxText = {
  type: "problem",
  meta: {
    type: "problem",
    docs: {
      description:
        'Le texte visible dans le JSX doit passer par i18n (t("...")), pas être écrit en dur.',
    },
    messages: {
      hardcodedText:
        'Texte visible écrit en dur : "{{text}}" — passer par t("cle.i18n") pour rester traduisible.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replace(/\\/g, "/");
    const isUi = /\/(components|src\/ai\/components|modules)\//.test(filename);
    const isPage = /\/app\//.test(filename);
    if (!isUi && !isPage) return {};
    if (/\.test\.|__tests__|\.stories\./.test(filename)) return {};

    /** Chaînes purement techniques autorisées (unités, symboles). */
    function isTechnical(text) {
      const trimmed = text.trim();
      if (trimmed === "") return true;
      if (/^[-–—:;,.·|/()[\]{}%#@&*+=<>≤≥°±×÷∞€$£¥]$/.test(trimmed)) return true;
      if (/^(KB|MB|GB|ms|s|min|h|d|x)$/i.test(trimmed)) return true;
      return false;
    }

    /** Texte lisible = au moins 2 lettres consécutives. */
    function isReadable(text) {
      return /[a-zA-Zàâäéèêëïîôöùûüç]{2}/.test(text);
    }

    return {
      JSXText(node) {
        if (typeof node.value !== "string") return;
        const text = node.value.replace(/\s+/g, " ").trim();
        if (!text || isTechnical(text) || !isReadable(text)) return;
        context.report({
          node,
          messageId: "hardcodedText",
          data: { text: text.slice(0, 40) },
        });
      },
      'JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=string]'(
        node,
      ) {
        if (isTechnical(node.value) || !isReadable(node.value)) return;
        context.report({
          node,
          messageId: "hardcodedText",
          data: { text: node.value.slice(0, 40) },
        });
      },
    };
  },
};

const plugin = {
  rules: {
    "no-hardcoded-jsx-text": noHardcodedJsxText,
  },
};

export default plugin;
