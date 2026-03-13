# Markdown

WYSIWYG


# TODO

- Header
- [x] checkbox
- code block add lang

1. 표준 기능 (CommonMark)
- 텍스트 스타일: **굵게**, *기울임*, ~~취소선~~, **~~*life*~~**
- 헤더: # ~ ###### (H1 ~ H6)
- 리스트: -, *, + (글머리 기호), 1. (번호 매기기)
- 인용구: >
- 코드: `인라인 코드`, ``` 코드 블록 ```
- 링크 & 이미지: [텍스트](URL), ![설명](이미지URL)
- 수평선: ---, ***, ___

2. 사실상 표준 (GFM - GitHub Flavored Markdown)
- GitHub에서 정의한 사양으로, 현재 대부분의 개발 도구(VS Code, Obsidian 등)가 이를 따릅니다.
- 표(Table): | 컬럼 |과 | --- | 구분선 사용
- 체크박스(Task Lists): - [ ] 미완료, - [x] 완료
- 자동 링크: URL을 그냥 적어도 링크로 변환
- 취소선: ~~텍스트~~ (CommonMark에는 엄밀히 말하면 없었으나 GFM에서 정착)

3. 주요 편의 기능 (비표준 / 확장)
- Frontmatter: 파일 최상단 --- 사이의 YAML 메타데이터 (Jekyll, Hugo, Next.js 등)
- 수식(Math): $E=mc^2$ 또는 $$ ... $$ (KaTeX, MathJax 라이브러리 필요)
- 다이어그램: ```mermaid (Mermaid.js 필요), PlantUML
- 콜아웃(Callouts): > [!INFO] 처럼 인용구에 아이콘과 색상을 넣는 기능 (Obsidian, GitHub 지원)
- 각주(Footnotes): [^1] 과 [^1]: 설명 (주로 학술적 용도)
- Wiki 링크: [[문서명]] (Obsidian, Logseq 등 지식 관리 도구에서 주로 사용)
- 이모지: :dog:를 🐶로 변환 (GitHub 및 Slack 스타일)