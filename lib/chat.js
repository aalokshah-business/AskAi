'use strict';
// Standing instruction for the chat apps AskAI cannot configure: Claude chat (claude.ai and the Claude desktop app),
// ChatGPT (web and desktop), and Gemini Apps. The coding apps stay on askai install. Nothing here is written into those apps.
// The instruction is short because each app sends it again on every turn.

const INSTRUCTION = [
  'Reply in the fewest words that answer. Answer first.',
  'Do not restate the question, add a preamble, or repeat the whole answer when one part changes.',
  'When this chat gets long, say so and stop. I will start a new chat.',
  'Ask for one file or a short excerpt, not a folder or a long log.',
].join(' ');

const PROJECT = [
  'This project is only this work. Do not use my other chats or my code repositories.',
  'Keep the standing facts here under 150 words: the goal, the audience, decisions already made, and the names of the pieces.',
  'Revise only the piece I name. Do not rewrite finished pieces.',
  'Return the changed part only.',
].join(' ');

const SURFACES = {
  claude: {
    title: 'Claude chat and the Claude desktop app',
    where: [
      'claude.ai and the Claude desktop app share one account. AskAI does not change their files.',
      'Every chat: initials at the lower left, Settings, Instructions for Claude. Paste the instruction printed above.',
      'One separate work, such as a book: create a project and open Set project instructions. Paste the project brief below, not the whole manuscript. The project name is not shown to Claude. Add only the current chapter as knowledge. A file in project knowledge is used in every chat in that project.',
      'In a chat: plus menu, Use style, Concise. A style applies to that chat.',
      'Pick Sonnet for a routine chat. A larger model costs more of the plan. The reset is on claude.ai, Settings, Usage. AskAI cannot start it.',
    ],
  },
  chatgpt: {
    title: 'ChatGPT on the web and the ChatGPT desktop app',
    where: [
      'The web app and the desktop app share custom instructions. AskAI does not change their files. This is not Codex. Codex is the coding app, set up with askai install --target codex.',
      'Settings, Personalization, Custom instructions. Turn Enable customization on. Paste the instruction printed above.',
      'One separate work, such as a book: New project, then the project menu, Project settings. Paste the project brief below. Inside that project it replaces the global custom instructions. If the plan offers project-only memory, turn that on so this work stays out of your other chats. Upload the current chapter only, not the whole manuscript.',
      'Pick the cheaper model your plan offers for a routine chat.',
      'Usage and the reset are in ChatGPT settings. AskAI cannot read that counter or move the reset.',
    ],
  },
  gemini: {
    title: 'Gemini Apps (gemini.google.com and the Gemini app)',
    where: [
      'This is separate from Antigravity. Antigravity is the coding app, set up with askai install --target agy.',
      'On a computer: gemini.google.com, Settings and help, Personal Intelligence, Instructions for Gemini, Add. Paste the instruction printed above and click Submit. Leave Instructions for Gemini on.',
      'Sign in with a personal Google account. Instructions apply to every chat. They are a different setting from Memory, which is not on every account.',
      'One separate work, such as a book: make a Gem, paste the project brief as its instructions, and add the current chapter only. Do not put the manuscript in the account-wide instructions. Google is moving Gems to skills.',
      'AskAI cannot read Gemini usage or move its reset.',
    ],
  },
  code: {
    title: 'Claude Code, Cursor, Codex, and Antigravity',
    where: [
      'These four are already AskAI hosts. Do not paste the chat instruction into them. AskAI writes their rules during install.',
      'Sign in first. Claude Code: claude, then /login. Codex: codex, then sign in with your ChatGPT account. Cursor: sign in in the editor. Antigravity: agy, then sign in with Google.',
      'Then askai install --yes --target claude, or cursor, codex, agy, or all. Restart the app. Open the project folder itself.',
      'In chat, type / and choose askai-cli. Codex uses $askai-cli. /askai-plugins finishes one-time plugin setup.',
      'Claude Code and Codex spend is askai usage 7. Cursor and Antigravity show usage in their own screens. A limit resets on the plan clock. AskAI cannot move that reset.',
    ],
  },
};

const ORDER = ['claude', 'chatgpt', 'gemini', 'code'];

function section(id, paste) {
  const s = SURFACES[id];
  const lines = [`## ${s.title}`, '', ...s.where];
  if (paste && id !== 'code') lines.push('', 'Instruction for every chat:', INSTRUCTION, '', 'Brief for one separate project:', PROJECT, '', 'Start a new chat inside that project for each piece of work. The brief stays. The old chat is not sent again.');
  return lines.join('\n');
}

function render(which) {
  const id = (which || 'all').toLowerCase();
  if (id === 'all') {
    return [
      'AskAI cannot install into Claude chat, the ChatGPT desktop app, or Gemini Apps. Paste one short instruction. It is sent on every turn, so it stays short.',
      'The coding apps are Claude Code, Cursor, Codex, and Antigravity. Use askai install for those.',
      '',
      'Instruction for every chat:',
      INSTRUCTION,
      '',
      'Brief for one separate project:',
      PROJECT,
      '',
      ...ORDER.map(id => section(id, false)),
    ].join('\n');
  }
  if (!SURFACES[id]) throw new Error(`askai chat: unknown surface "${which}". Use ${ORDER.join(', ')}, or no name for all.`);
  return section(id);
}

module.exports = { INSTRUCTION, PROJECT, ORDER, SURFACES, render };
