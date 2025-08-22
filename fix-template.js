// scripts/fix-template.js
const fs = require("fs");
const PizZip = require("pizzip");

function patchDocx(inputPath, outputPath) {
  const buf = fs.readFileSync(inputPath);
  const zip = new PizZip(buf);

  // Patch main document and all headers/footers
  const targets = [
    "word/document.xml",
    ...["header1.xml","header2.xml","header3.xml","footer1.xml","footer2.xml","footer3.xml"]
      .map(f => "word/" + f)
      .filter(name => !!zip.files[name])
  ];

  for (const name of targets) {
    let xml = zip.file(name).asText();

    // 1) Remove any placeholder that accidentally wraps Word XML runs
    //    e.g. {{</w:t>...}}  (this is what’s breaking your file)
    xml = xml.replace(/\{\{\s*<\/w:t>[\s\S]*?\}\}/g, "");

    // 2) Remove totally empty placeholders like {{   }}
    xml = xml.replace(/\{\{\s*\}\}/g, "");

    // 3) Optional: collapse stray doubled braces like {{{{ -> {{
    xml = xml.replace(/\{\{\s*\{\{/g, "{{").replace(/\}\}\s*\}\}/g, "}}");

    zip.file(name, xml);
  }

  const outBuf = zip.generate({ type: "nodebuffer" });
  fs.writeFileSync(outputPath, outBuf);
  console.log(`Patched template written to: ${outputPath}`);
}

// Usage: node scripts/fix-template.js public/ProgramTemplate.docx public/template_patched.docx
const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node scripts/fix-template.js <input.docx> <output.docx>");
  process.exit(1);
}
patchDocx(inPath, outPath);
