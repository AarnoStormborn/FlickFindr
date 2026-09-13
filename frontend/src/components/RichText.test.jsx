import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RichText from './RichText';

/**
 * The models we use ignore "reply in plain prose" instructions (free tiers
 * especially), so this renderer is what actually keeps `###` and `**` out of
 * the chat. Tests pin the subset we promise to handle.
 */
describe('RichText', () => {
    it('renders **bold** as a <strong> without leaving asterisks', () => {
        const { container } = render(<RichText text="Try **Lost in Translation** tonight." />);
        expect(screen.getByText('Lost in Translation')).toBeInTheDocument();
        expect(container.querySelector('strong')).toBeTruthy();
        expect(container.textContent).toBe('Try Lost in Translation tonight.');
    });

    it('strips markdown heading hashes', () => {
        const { container } = render(<RichText text={'### Top picks\nA quiet film.'} />);
        expect(container.textContent).not.toContain('#');
        expect(container.textContent).toContain('Top picks');
    });

    it('renders --- as a divider rather than literal dashes', () => {
        const { container } = render(<RichText text={'First.\n\n---\n\nSecond.'} />);
        expect(container.querySelector('hr.chat-rich-rule')).toBeTruthy();
        expect(container.textContent).not.toContain('---');
    });

    it('groups - bullets into a list', () => {
        const { container } = render(<RichText text={'- One\n- Two\n- Three'} />);
        const items = container.querySelectorAll('.chat-rich-list li');
        expect(items).toHaveLength(3);
        expect(items[0]).toHaveTextContent('One');
        expect(container.querySelectorAll('p')).toHaveLength(0);
    });

    it('splits separate lines into paragraphs', () => {
        const { container } = render(<RichText text={'First para.\n\nSecond para.'} />);
        expect(container.querySelectorAll('p.chat-rich-p')).toHaveLength(2);
    });

    it('drops single-asterisk emphasis markers', () => {
        const { container } = render(<RichText text={'A *very* quiet movie.'} />);
        expect(container.textContent).toBe('A very quiet movie.');
    });

    it('never renders raw HTML from model output', () => {
        const { container } = render(<RichText text={'<img src=x onerror=alert(1)>hello'} />);
        // Rendered as text, not parsed into a live element.
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('<img');
    });

    it('handles empty and nullish input', () => {
        const { container } = render(<RichText text={undefined} />);
        expect(container.textContent).toBe('');
    });
});
