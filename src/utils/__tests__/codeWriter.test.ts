import fs from 'fs';
import path from 'path';
import { writeGeneratedCode } from '../codeWriter';

jest.mock('fs');

describe('CodeWriter', () => {
  const projectName = 'Test Project';
  const outputDir = path.join(process.cwd(), 'generated-code', 'test-project');

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  it('should parse and write files from actions text', () => {
    const actionsText = `
FILE: src/index.ts
\`\`\`typescript
console.log("hello");
\`\`\`

FILE: README.md
\`\`\`markdown
# My Project
\`\`\`
`;

    const writtenFiles = writeGeneratedCode(actionsText, projectName);

    expect(writtenFiles).toEqual(['src/index.ts', 'README.md']);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(outputDir, 'src/index.ts'),
      'console.log("hello");\n'
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(outputDir, 'README.md'),
      '# My Project\n'
    );
  });

  it('should create directories if they do not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const actionsText = `
FILE: new/dir/file.ts
\`\`\`typescript
const x = 1;
\`\`\`
`;

    writeGeneratedCode(actionsText, projectName);

    expect(fs.mkdirSync).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(outputDir, 'new/dir'), { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should return empty array if no files found', () => {
    const actionsText = 'Just some text without file blocks.';
    const writtenFiles = writeGeneratedCode(actionsText, projectName);
    expect(writtenFiles).toEqual([]);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
