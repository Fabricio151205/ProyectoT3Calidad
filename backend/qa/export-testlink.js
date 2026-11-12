const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'QA_CASES.md');
const outputPath = path.join(__dirname, 'testlink-import.xml');

function cdata(value) {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function attribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function html(value) {
  return `<p>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
}

function parseCases(markdown) {
  const cases = [];
  let story = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## (HU-\d+) — (.+)$/);
    if (heading) {
      story = { id: heading[1], title: heading[2], cases: [] };
      cases.push(story);
      continue;
    }

    if (!story || !/^\| CP-\d{3} \|/.test(line)) continue;
    const columns = line.split('|').slice(1, -1).map((column) => column.trim());
    if (columns.length !== 5) {
      throw new Error(`Fila de caso TestLink inválida: ${line}`);
    }
    const [id, title, type, expected, coverage] = columns;
    story.cases.push({ id, title, type, expected, coverage });
  }

  if (!cases.length || cases.some((story) => !story.cases.length)) {
    throw new Error('No se encontraron casos en QA_CASES.md.');
  }
  return cases;
}

function testcaseXml(testCase, order) {
  const name = `${testCase.id} - ${testCase.title}`;
  const summary = html(`Tipo: ${testCase.type}. Cobertura: ${testCase.coverage}.`);
  const actions = html(`Ejecutar el escenario: ${testCase.title}.`);
  const expected = html(testCase.expected);
  return `  <testcase name="${attribute(name)}">
    <node_order>${cdata(String(order))}</node_order>
    <version>${cdata('1')}</version>
    <summary>${cdata(summary)}</summary>
    <preconditions>${cdata(html(`Historia de usuario ${testCase.storyId}.`))}</preconditions>
    <execution_type>${cdata('1')}</execution_type>
    <importance>${cdata('2')}</importance>
    <steps>
      <step>
        <step_number>${cdata('1')}</step_number>
        <actions>${cdata(actions)}</actions>
        <expectedresults>${cdata(expected)}</expectedresults>
        <execution_type>${cdata('1')}</execution_type>
      </step>
    </steps>
  </testcase>`;
}

function buildXml(stories) {
  let order = 1;
  const suites = stories.map((story) => {
    const testcases = story.cases.map((testCase) => {
      testCase.storyId = story.id;
      return testcaseXml(testCase, order++);
    });
    return `  <testsuite name="${attribute(`${story.id} - ${story.title}`)}">
    <node_order>${cdata(String(order))}</node_order>
    <details>${cdata(html(`Casos de prueba de ${story.id}.`))}</details>
${testcases.join('\n')}
  </testsuite>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="LabTrack">
  <node_order>${cdata('1')}</node_order>
  <details>${cdata(html('Casos de prueba organizados por historia de usuario.'))}</details>
${suites.join('\n')}
</testsuite>\n`;
}

function main() {
  const stories = parseCases(readFileSync(sourcePath, 'utf8'));
  const xml = buildXml(stories);
  const testCaseCount = stories.reduce((total, story) => total + story.cases.length, 0);
  writeFileSync(outputPath, xml, 'utf8');
  console.log(`Exportados ${testCaseCount} casos en ${path.relative(process.cwd(), outputPath)}`);
}

if (require.main === module) main();

module.exports = { buildXml, parseCases };
