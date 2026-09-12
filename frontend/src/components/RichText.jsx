/**
 * Minimal renderer for the light markdown that LLMs emit unprompted.
 *
 * The models we use (free tiers especially) ignore "reply in plain prose"
 * instructions, so the UI has to cope with `**bold**`, `### headings`,
 * `---` rules and `-` bullets. This maps that subset onto React elements —
 * never `dangerouslySetInnerHTML`, so model output cannot inject markup.
 */

/** Split a line into plain strings and <strong> nodes on `**bold**`. */
function renderInline(text, keyPrefix) {
    const parts = [];
    const pattern = /\*\*(.+?)\*\*/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index));
        parts.push(<strong key={`${keyPrefix}-b${match.index}`}>{match[1]}</strong>);
        last = pattern.lastIndex;
    }
    if (last < text.length) parts.push(text.slice(last));
    // Also drop single-asterisk/underscore emphasis markers left dangling.
    return parts.map((p) =>
        typeof p === 'string' ? p.replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$)/g, '$1$2') : p,
    );
}

/** Strip leading markdown heading hashes from a line. */
function stripHeading(line) {
    return line.replace(/^\s*#{1,6}\s*/, '');
}

/**
 * Render assistant text as block elements.
 * @param {string} text raw model output
 */
export default function RichText({ text }) {
    // Normalise: collapse 3+ blank lines, trim trailing spaces.
    const lines = String(text ?? '')
        .replace(/\r/g, '')
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''));

    const blocks = [];
    let bullets = [];
    let key = 0;

    const flushBullets = () => {
        if (!bullets.length) return;
        blocks.push(
            <ul className="chat-rich-list" key={`ul-${key++}`}>
                {bullets.map((b, i) => (
                    <li key={i}>{renderInline(b, `li-${key}-${i}`)}</li>
                ))}
            </ul>,
        );
        bullets = [];
    };

    for (const rawLine of lines) {
        const line = stripHeading(rawLine);
        const trimmed = line.trim();

        // Horizontal rule -> divider
        if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed)) {
            flushBullets();
            blocks.push(<hr className="chat-rich-rule" key={`hr-${key++}`} />);
            continue;
        }

        // Bullet list item
        const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
        if (bullet) {
            bullets.push(bullet[1]);
            continue;
        }

        if (!trimmed) {
            flushBullets();
            continue;
        }

        flushBullets();
        blocks.push(
            <p className="chat-rich-p" key={`p-${key++}`}>
                {renderInline(line, `p-${key}`)}
            </p>,
        );
    }
    flushBullets();

    return <div className="chat-rich">{blocks}</div>;
}
