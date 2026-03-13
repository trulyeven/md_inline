import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visitParents } from 'unist-util-visit-parents';
import type { Root, Node, Strong, Emphasis, Heading, InlineCode, Delete, Code, Link, Image, Table, TableRow, TableCell, ListItem, Blockquote, Paragraph } from 'mdast';

export type DecorationType = 'hide' | 'bold' | 'italic' | 'strikethrough' | 'code' | 'codeBlock' |
    'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' |
    'tableRow' | 'tableHeaderRow' | 'tableCell' | 'link' | 'image' | 'hr' |
    'blockquote_bg' | 'blockquote_marker' |
    'ul_bullet_1' | 'ul_bullet_2' | 'ul_bullet_3' | 'ul_bullet_4';

export interface DecorationRange {
    startPos: number;
    endPos: number;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
    type: DecorationType;
    metadata?: any;
    blockId?: string;
    activeRangeStart?: number;
    activeRangeEnd?: number;
}

type PushRangeFn = (start: number, end: number, type: DecorationType,
    opts?: { metadata?: any, blockId?: string, activeRangeStart?: number, activeRangeEnd?: number }) => void;

/**
 * MarkdownParser handles parsing Markdown text into a set of decoration ranges.
 * It uses unified/remark to build an AST and then visits nodes to apply styles
 */
export class MarkdownParser {
    private processor: any;
    private lastText: string = '';
    private lastRanges: DecorationRange[] = [];
    private handlers: Record<string, (node: any, ancestors: Node[], text: string, pushRange: PushRangeFn) => void>;

    /**
     * Initialize the unified processor with remark-parse and remark-gfm.
     * Sets up handlers for various Markdown node types
     */
    constructor() {
        this.processor = unified()
            .use(remarkParse)
            .use(remarkGfm);

        this.handlers = {
            'strong': (node, _, text, push) => this.processBold(text, push, node.position.start.offset, node.position.end.offset),
            'emphasis': (node, _, text, push) => this.processItalic(text, push, node.position.start.offset, node.position.end.offset),
            'delete': (node, _, text, push) => this.processStrikethrough(text, push, node.position.start.offset, node.position.end.offset),
            'heading': (node, _, text, push) => this.processHeading(node as Heading, text, push, node.position.start.offset, node.position.end.offset),
            'link': (node, _, text, push) => this.processLink(text, push, node.position.start.offset, node.position.end.offset),
            'image': (node, ancestors, text, push) => this.processImage(node as Image, text, push, node.position.start.offset, node.position.end.offset, ancestors),
            'inlineCode': (node, _, text, push) => this.processInlineCode(text, push, node.position.start.offset, node.position.end.offset),
            'code': (node, _, text, push) => this.processCodeBlock(node as Code, text, push, node.position.start.offset, node.position.end.offset),
            'table': (node, _, text, push) => this.processTable(node as Table, text, push, node.position.start.offset, node.position.end.offset),
            'listItem': (node, ancestors, text, push) => this.processListItem(node as ListItem, text, ancestors, push, node.position.start.offset, node.position.end.offset),
            'blockquote': (node, ancestors, text, push) => this.processBlockquote(text, push, node.position.start.offset, node.position.end.offset, ancestors),
            'thematicBreak': (node, _, __, push) => this.processHR(push, node.position.start.offset, node.position.end.offset)
        };
    }

    /**
     * Parses the given Markdown text and returns an array of DecorationRange objects
     * Uses caching to skip parsing if the text hasn't changed
    **/
    public parse(text: string): DecorationRange[] {
        if (!text) { return []; }
        if (text === this.lastText) {
            return this.lastRanges;
        }

        const ranges: DecorationRange[] = [];
        const lineOffsets: number[] = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') {
                lineOffsets.push(i + 1);
            }
        }

        const getPos = (offset: number) => {
            let low = 0, high = lineOffsets.length - 1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (lineOffsets[mid] <= offset) {
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            const line = high;
            const col = offset - lineOffsets[line];
            return { line, col };
        };

        const pushRange: PushRangeFn = (start, end, type, opts = {}) => {
            const startP = getPos(start);
            const endP = getPos(end);
            ranges.push({
                startPos: start, endPos: end,
                startLine: startP.line, startCol: startP.col,
                endLine: endP.line, endCol: endP.col,
                type, ...opts
            });
        };

        try {
            const ast = this.processor.parse(text) as Root;

            visitParents(ast, (node: Node, ancestors: Node[]) => {
                const pos = node.position;
                if (!pos || pos.start.offset === undefined || pos.end.offset === undefined) {
                    return;
                }

                const handler = this.handlers[node.type];
                if (handler) {
                    const blockId = this.getFormattingRootId(node, ancestors);
                    // Use a wrapped push function to automatically inject the clustered blockId
                    const wrappedPush: PushRangeFn = (start, end, type, opts = {}) => {
                        pushRange(start, end, type, { blockId, ...opts });
                    };
                    handler(node, ancestors, text, wrappedPush);
                }
            });
        } catch (e) {
            console.error("Failed to parse markdown", e);
        }

        this.lastText = text;
        this.lastRanges = ranges;
        return ranges;
    }

    /**
     * Determines a shared blockId for nested inline formatting elements
     */
    private getFormattingRootId(node: Node, ancestors: Node[]): string | undefined {
        const formattingTypes = ['strong', 'emphasis', 'delete', 'link', 'inlineCode', 'heading', 'image'];
        if (!formattingTypes.includes(node.type)) {
            return undefined;
        }

        let root = node;
        for (let i = ancestors.length - 1; i >= 0; i--) {
            const ancestor = ancestors[i];
            if (formattingTypes.includes(ancestor.type)) {
                root = ancestor;
            } else if (['paragraph', 'listItem', 'tableCell', 'blockquote', 'list', 'root'].includes(ancestor.type)) {
                // Formatting cluster boundary
                break;
            }
        }

        if (root.position?.start?.offset !== undefined) {
            return `inline-${root.position.start.offset}`;
        }
        return undefined;
    }

    /**
     * Process bold text (e.g., **text** or __text__).
     * Hides the markers and applies the 'bold' decoration to the content.
     */
    private processBold(text: string, pushRange: PushRangeFn, start: number, end: number) {
        // Strong is always 2 characters (** or __).
        // If it's ***, AST treats it as Strong(**) + Emphasis(*) inside.
        pushRange(start, start + 2, 'hide', { activeRangeStart: start, activeRangeEnd: end });
        pushRange(start + 2, end - 2, 'bold', { activeRangeStart: start, activeRangeEnd: end });
        pushRange(end - 2, end, 'hide', { activeRangeStart: start, activeRangeEnd: end });
    }

    /**
     * Process italic text (e.g., *text* or _text_).
     * Hides the markers and applies the 'italic' decoration to the content.
     */
    private processItalic(text: string, pushRange: PushRangeFn, start: number, end: number) {
        // Emphasis is always 1 character (* or _).
        pushRange(start, start + 1, 'hide', { activeRangeStart: start, activeRangeEnd: end });
        pushRange(start + 1, end - 1, 'italic', { activeRangeStart: start, activeRangeEnd: end });
        pushRange(end - 1, end, 'hide', { activeRangeStart: start, activeRangeEnd: end });
    }

    /**
     * Process strikethrough text (e.g., ~~text~~).
     * Hides the markers and applies the 'strikethrough' decoration.
     */
    private processStrikethrough(text: string, pushRange: PushRangeFn, start: number, end: number) {
        pushRange(start, start + 2, 'hide', { activeRangeStart: start, activeRangeEnd: end });
        pushRange(start + 2, end - 2, 'strikethrough', { activeRangeStart: start, activeRangeEnd: end });
        pushRange(end - 2, end, 'hide', { activeRangeStart: start, activeRangeEnd: end });
    }

    /**
     * Process Markdown headings (# H1, ## H2, etc.).
     * Hides the marker part (e.g., '### ') and applies a heading-specific decoration.
     */
    private processHeading(heading: Heading, text: string, pushRange: PushRangeFn, start: number, end: number) {
        const level = heading.depth;
        const headingType = `heading${level}` as DecorationType;
        let markerEnd = start + level;
        while (markerEnd < end && (text[markerEnd] === ' ' || text[markerEnd] === '\t')) {
            markerEnd++;
        }
        pushRange(start, markerEnd, 'hide', { activeRangeStart: start, activeRangeEnd: end });
        if (markerEnd < end) {
            pushRange(markerEnd, end, headingType, { activeRangeStart: start, activeRangeEnd: end });
        }
    }

    /**
     * Process Markdown links [label](url).
     * Hides the brackets and URL part, styling only the label.
     */
    private processLink(text: string, pushRange: PushRangeFn, start: number, end: number) {
        const raw = text.substring(start, end);
        const closingBracketIdx = raw.lastIndexOf('](');
        if (closingBracketIdx !== -1) {
            const urlPart = raw.substring(closingBracketIdx + 2, raw.length - 1);
            pushRange(start, start + 1, 'hide', { activeRangeStart: start, activeRangeEnd: end });
            pushRange(start + 1, start + closingBracketIdx, 'link', { metadata: { url: urlPart }, activeRangeStart: start, activeRangeEnd: end });
            pushRange(start + closingBracketIdx, end, 'hide', { activeRangeStart: start, activeRangeEnd: end });
        }
    }

    /**
     * Process Markdown images ![alt](url).
     * Provides metadata for the decorator to render an image preview or anchor.
     */
    private processImage(node: Image, text: string, pushRange: PushRangeFn, start: number, end: number, ancestors: Node[]) {
        const url = node.url;
        const alt = node.alt;
        const parent = ancestors[ancestors.length - 1];
        const isBlock = parent && parent.type === 'paragraph' && (parent as Paragraph).children.length === 1;
        const metadata = { url, alt, isBlock };

        // Mark the entire markup as 'image' to provide a large hover surface area
        pushRange(start, end, 'image', { metadata, activeRangeStart: start, activeRangeEnd: end });
    }


    // pushRange(start, start + 1, 'hide', { activeRangeStart: start, activeRangeEnd: end });
    // pushRange(start + 1, end - 1, 'code', { activeRangeStart: start, activeRangeEnd: end });
    // pushRange(end - 1, end, 'hide', { activeRangeStart: start, activeRangeEnd: end });

    /**
     * Process inline code (e.g., `code`).
     * Hides backticks and applies the 'code' background decoration.
     */
    private processInlineCode(text: string, pushRange: PushRangeFn, start: number, end: number) {
        let openLen = 0;
        while (start + openLen < end && text[start + openLen] === '`') {
            openLen++;
        }
        let closeLen = 0;
        while (end - 1 - closeLen >= start + openLen && text[end - 1 - closeLen] === '`') {
            closeLen++;
        }

        if (openLen > 0 && closeLen > 0) {
            pushRange(start, start + openLen, 'hide', { activeRangeStart: start, activeRangeEnd: end });
            pushRange(end - closeLen, end, 'hide', { activeRangeStart: start, activeRangeEnd: end });
            // Only apply 'code' background to the content inside the markers
            pushRange(start + openLen, end - closeLen, 'code', { activeRangeStart: start, activeRangeEnd: end });
        } else {
            pushRange(start, end, 'code', { activeRangeStart: start, activeRangeEnd: end });
        }
    }

    /**
     * Process fenced code blocks (```lang ... ```).
     * Hides the start/end fences and applies 'codeBlock' styling to the whole range.
     */
    private processCodeBlock(node: Code, text: string, pushRange: PushRangeFn, start: number, end: number) {
        const blockId = `code-${start}`;
        const firstNewline = text.indexOf('\n', start);
        if (firstNewline !== -1 && firstNewline < end) {
            pushRange(start, firstNewline + 1, 'hide', { blockId });
            const lastNewline = text.lastIndexOf('\n', end - 1);
            if (lastNewline !== -1 && lastNewline > firstNewline) {
                pushRange(lastNewline, end, 'hide', { blockId });
            }
        }
        pushRange(start, end, 'codeBlock', { blockId });
    }

    /**
     * Process Markdown tables. 
     */
    private processTable(node: Table, text: string, pushRange: PushRangeFn, start: number, end: number) {
        const blockId = `table-${start}`;

        const visualLength = (str: string) => {
            let len = 0;
            for (const char of str) {
                const cp = char.codePointAt(0)!;
                len += cp > 0xFFFF ? 2 : cp > 255 ? 2 : 1;
            }
            return len;
        };

        // Helper: Extract only visible text from AST node to ignore hidden markdown markers
        const getVisibleText = (node: any): string => {
            if (node.type === 'text' || node.type === 'inlineCode') {
                return node.value || '';
            }
            if (node.children) {
                return node.children.map(getVisibleText).join('');
            }
            return '';
        };

        const colWidths: number[] = [];
        const visibleTexts = new Map<any, string>();

        node.children.forEach(row => {
            row.children.forEach((cell, i) => {
                const visibleText = getVisibleText(cell).trim();
                visibleTexts.set(cell, visibleText);
                colWidths[i] = Math.max(colWidths[i] || 3, visualLength(visibleText));
            });
        });
        const totalTableWidth = colWidths.reduce((a, b) => a + b + 4, 0);
        const firstNewlineIdx = text.indexOf('\n', start);
        const secondNewlineIdx = firstNewlineIdx !== -1 ? text.indexOf('\n', firstNewlineIdx + 1) : -1;
        const sepEnd = secondNewlineIdx !== -1 && secondNewlineIdx < end ? secondNewlineIdx + 1 : end;

        if (firstNewlineIdx !== -1 && firstNewlineIdx < end) {
            const sepLine = text.substring(firstNewlineIdx + 1, sepEnd);
            // Markdown Separator Line
            if (sepLine.trim().match(/^\|?(\s*:?-+:?\s*\|?)+$/)) {
                const visualEnd = secondNewlineIdx !== -1 ? secondNewlineIdx : sepEnd;
                pushRange(firstNewlineIdx + 1, visualEnd, 'tableHeaderRow', {
                    blockId,
                    metadata: { totalWidth: totalTableWidth },
                    activeRangeStart: start,
                    activeRangeEnd: end
                });
            }
        }

        // Other Rows
        node.children.forEach((row, rowIndex) => {
            const rowStart = row.position?.start?.offset;
            const rowEnd = row.position?.end?.offset;

            if (rowIndex > 0) {
                if (rowStart !== undefined && rowEnd !== undefined) {
                    const rawLine = text.substring(rowStart, rowEnd);
                    if (!rawLine.includes('|')) {
                        return;
                    }
                }
            }

            // Row Line
            if (rowStart !== undefined && rowEnd !== undefined) {
                if (rowIndex > 0) {
                    const nextRow = node.children[rowIndex + 1];
                    if (nextRow && nextRow.position?.start?.offset !== undefined && nextRow.position?.end?.offset !== undefined) {
                        pushRange(nextRow.position.start.offset, nextRow.position.start.offset, 'tableRow', {
                            blockId,
                            metadata: { totalWidth: totalTableWidth },
                            activeRangeStart: start,
                            activeRangeEnd: end
                        });
                    }
                }
            }

            row.children.forEach((cell, i) => {
                if (!cell.position || cell.position.start.offset === undefined || cell.position.end.offset === undefined) {
                    return;
                }
                const cellStart = cell.position.start.offset;
                const cellEnd = cell.position.end.offset;

                let innerStart = cellStart;
                let innerEnd = cellStart;

                if (cell.children.length > 0) {
                    const firstChildPos = cell.children[0].position;
                    const lastChildPos = cell.children[cell.children.length - 1].position;

                    if (firstChildPos && lastChildPos && firstChildPos.start.offset !== undefined && lastChildPos.end.offset !== undefined) {
                        innerStart = firstChildPos.start.offset;
                        innerEnd = lastChildPos.end.offset;
                    }
                } else {
                    const rawText = text.substring(cellStart, cellEnd);
                    const nonSpaceIdx = rawText.search(/[^ \t|]/);

                    if (nonSpaceIdx !== -1) {
                        innerStart = cellStart + nonSpaceIdx;
                        let lastIdx = rawText.length - 1;
                        while (lastIdx >= 0 && (rawText[lastIdx] === ' ' || rawText[lastIdx] === '\t' || rawText[lastIdx] === '|')) lastIdx--;
                        innerEnd = cellStart + lastIdx + 1;
                    } else if (cellEnd > cellStart) {
                        const mid = Math.floor((cellStart + cellEnd) / 2);
                        innerStart = mid;
                        innerEnd = mid + 1;
                    } else {
                        innerStart = cellStart;
                        innerEnd = cellEnd;
                    }
                }

                const len = visualLength(visibleTexts.get(cell) || '');
                const diff = Math.max((colWidths[i] || 3) - len, 0);

                if (innerStart > cellStart) {
                    pushRange(cellStart, innerStart, 'hide', { blockId, activeRangeStart: start, activeRangeEnd: end });
                }
                if (innerEnd < cellEnd) {
                    pushRange(innerEnd, cellEnd, 'hide', { blockId, activeRangeStart: start, activeRangeEnd: end });
                }

                pushRange(innerStart, innerEnd, 'tableCell', {
                    blockId,
                    metadata: { diff, align: node.align?.[i], empty: cell.children.length === 0, isHeader: rowIndex === 0 },
                    activeRangeStart: start,
                    activeRangeEnd: end
                });
            });
        });
    }

    /**
     * Process unordered list items.
     * Replaces the standard marker (-, *, +) with custom bullet decorations.
     */
    private processListItem(node: ListItem, text: string, ancestors: Node[], pushRange: PushRangeFn, start: number, end: number) {
        const blockId = `item-${start}`;

        let listDepth = 0;
        let isOrdered = false;
        for (let i = ancestors.length - 1; i >= 0; i--) {
            if (ancestors[i].type === 'list') {
                listDepth++;
                if (listDepth === 1) {
                    isOrdered = (ancestors[i] as any).ordered;
                }
            }
        }
        if (isOrdered) { return; }

        let i = start;
        while (i < end && (text[i] === ' ' || text[i] === '\t')) { i++; }
        const markerStart = i;
        while (i < end && (text[i] === '*' || text[i] === '-' || text[i] === '+')) { i++; }
        const markerEnd = i;
        if (markerEnd > markerStart) {
            if (i < end && (text[i] === ' ' || text[i] === '\t')) { i++; }
            // Marker visibility depends on the entire line/item start, but restrict it from bleeding into the next line
            let activeEnd = text.indexOf('\n', markerStart);
            if (activeEnd === -1 || activeEnd > end) activeEnd = end;

            pushRange(markerStart, i, 'hide', { blockId, activeRangeStart: start, activeRangeEnd: activeEnd });
            const levelIndex = ((listDepth - 1) % 4) + 1;
            const bulletType = `ul_bullet_${levelIndex}` as DecorationType;
            pushRange(markerStart, markerStart, bulletType, { blockId });
        }
    }

    /**
     * Process blockquotes (> text).
     * Applies a vertical bar styling to the markers and a background to the content.
     */
    private processBlockquote(text: string, pushRange: PushRangeFn, start: number, end: number, ancestors: Node[]) {
        // Handle nesting by only processing at the root blockquote level to avoid duplicate marker logic
        if (ancestors.some(a => a.type === 'blockquote')) { return; }

        const outerQuote = ancestors.find(a => a.type === 'blockquote') as Blockquote || { position: { start: { offset: start } } };
        const blockId = `quote-${outerQuote.position?.start?.offset ?? start}`;
        pushRange(start, end, 'blockquote_bg', { blockId });

        let currentOffset = start;
        const subText = text.substring(start, end);
        const lines = subText.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineEnd = currentOffset + line.length + (i === lines.length - 1 ? 0 : 1);

            // Match markers like ">", ">>", "> >"
            const match = line.match(/^(\s*)([> \t]*>[> \t]*)(.*)$/);
            if (match) {
                const whitespace = match[1];
                const markerPart = match[2];

                // Hide leading whitespace
                if (whitespace.length > 0) {
                    pushRange(currentOffset, currentOffset + whitespace.length, 'hide', { blockId, activeRangeStart: currentOffset, activeRangeEnd: lineEnd });
                }

                // For each character in the marker part, either hide space or style '>'
                let markerIndex = 0;
                for (let j = 0; j < markerPart.length; j++) {
                    const charStart = currentOffset + whitespace.length + j;
                    if (markerPart[j] === ' ' || markerPart[j] === '\t') {
                        pushRange(charStart, charStart + 1, 'hide', { blockId, activeRangeStart: currentOffset, activeRangeEnd: lineEnd });
                    } else if (markerPart[j] === '>') {
                        markerIndex++;
                        pushRange(charStart, charStart + 1, 'blockquote_marker', {
                            blockId,
                            activeRangeStart: currentOffset,
                            activeRangeEnd: lineEnd,
                            metadata: { level: markerIndex }
                        });
                    }
                }
            }
            currentOffset = lineEnd;
        }
    }

    /**
     * Process horizontal rules (---, ***, etc.).
     * Hides the marker and renders a custom horizontal line.
     */
    private processHR(pushRange: PushRangeFn, start: number, end: number) {
        pushRange(start, end, 'hide');
        pushRange(start, end, 'hr');
    }
}
