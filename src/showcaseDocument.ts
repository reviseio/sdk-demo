const encoder = new TextEncoder();

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Record<string, string>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const [name, source] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(source);
    const checksum = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centralParts.length, true);
  endView.setUint16(10, centralParts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const totalSize = offset + centralSize + end.length;
  const archive = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

const packageRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="243447"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="220"/><w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="173F5F"/><w:sz w:val="64"/><w:szCs w:val="64"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="320"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="4F6475"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="260" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="173F5F"/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="20639B"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="SectionLabel"><w:name w:val="Section label"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:caps/><w:color w:val="20639B"/><w:spacing w:val="24"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="420"/><w:spacing w:before="160" w:after="200"/><w:shd w:val="clear" w:fill="EAF1F7"/><w:pBdr><w:left w:val="single" w:sz="22" w:space="12" w:color="20639B"/></w:pBdr></w:pPr><w:rPr><w:i/><w:color w:val="284C67"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:color w:val="5F7282"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
</w:styles>`;

const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="20639B"/></w:pBdr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:caps/><w:color w:val="20639B"/><w:spacing w:val="18"/><w:sz w:val="17"/></w:rPr><w:t>Northwind Analytics  •  Product Strategy Brief</w:t></w:r></w:p>
</w:hdr>`;

const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="right"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="C9D5DE"/></w:pBdr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="5F7282"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">CONFIDENTIAL  •  Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:rPr><w:color w:val="5F7282"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> of </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>NUMPAGES</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>4</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
</w:ftr>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="SectionLabel"/><w:spacing w:before="960"/></w:pPr><w:r><w:t>FY 2026  •  LEADERSHIP EDITION</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Product Strategy Brief</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr><w:r><w:t>Turning connected insights into confident decisions</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:before="680" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="173F5F"/></w:rPr><w:t>Prepared for</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>Executive Leadership Team</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Small"/></w:pPr><w:r><w:t>August 5, 2026  |  v1.0</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Quote"/><w:spacing w:before="720"/></w:pPr><w:r><w:t>“Make every operating decision faster, clearer, and easier to defend.”</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="SectionLabel"/></w:pPr><w:r><w:t>01  •  EXECUTIVE OVERVIEW</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A focused path to durable growth</w:t></w:r></w:p>
    <w:p><w:r><w:t>Northwind enters FY 2026 with strong customer retention, a clear enterprise wedge, and an opportunity to simplify how teams move from raw signals to action. This plan concentrates investment in three areas: a unified insight layer, guided workflows, and trust at enterprise scale.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>The strategy is deliberately narrow: win the moments where a decision is expensive, collaborative, and time-sensitive.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>FY 2026 scorecard</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="C9D5DE"/><w:left w:val="single" w:sz="6" w:color="C9D5DE"/><w:bottom w:val="single" w:sz="6" w:color="C9D5DE"/><w:right w:val="single" w:sz="6" w:color="C9D5DE"/><w:insideH w:val="single" w:sz="4" w:color="DCE5EB"/><w:insideV w:val="single" w:sz="4" w:color="DCE5EB"/></w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3200"/><w:gridCol w:w="2100"/><w:gridCol w:w="2100"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:shd w:fill="EAF1F7"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="173F5F"/></w:rPr><w:t>Measure</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="EAF1F7"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="173F5F"/></w:rPr><w:t>Current</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="EAF1F7"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="173F5F"/></w:rPr><w:t>FY 2026 target</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Enterprise ARR</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$18.4M</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$28.0M</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Gross retention</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>91%</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>94%</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Time to first insight</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4.2 days</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>&lt; 1 day</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>What changes this year</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="20639B"/></w:rPr><w:t>•</w:t></w:r><w:r><w:t xml:space="preserve">  One workspace replaces disconnected reporting handoffs.</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="20639B"/></w:rPr><w:t>•</w:t></w:r><w:r><w:t xml:space="preserve">  Guided decision flows turn best practice into a repeatable habit.</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="20639B"/></w:rPr><w:t>•</w:t></w:r><w:r><w:t xml:space="preserve">  Governance ships with the workflow instead of arriving after it.</w:t></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="SectionLabel"/></w:pPr><w:r><w:t>02  •  STRATEGIC PRIORITIES</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Three bets, one connected experience</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>1. Unified insight layer</w:t></w:r></w:p>
    <w:p><w:r><w:t>Connect customer, product, and operational signals in a governed semantic layer. Teams should be able to ask a business question and understand both the answer and its lineage without waiting for a custom dashboard.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>2. Guided decision workflows</w:t></w:r></w:p>
    <w:p><w:r><w:t>Package analysis, review, recommendation, and approval into shared workflows. Each workflow preserves context, ownership, and the rationale behind the final call.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>3. Enterprise trust by default</w:t></w:r></w:p>
    <w:p><w:r><w:t>Make permissions, auditability, regional controls, and quality signals visible at the point of work. Trust becomes a product advantage when customers can verify it without opening a support ticket.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Delivery roadmap</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:bottom w:val="single" w:sz="6" w:color="C9D5DE"/><w:insideH w:val="single" w:sz="4" w:color="DCE5EB"/></w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1300"/><w:gridCol w:w="2600"/><w:gridCol w:w="3600"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:shd w:fill="EAF1F7"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="173F5F"/></w:rPr><w:t>Quarter</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="EAF1F7"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="173F5F"/></w:rPr><w:t>Theme</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="EAF1F7"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:color w:val="173F5F"/></w:rPr><w:t>Customer outcome</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Q1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Connect</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Faster setup and governed source access</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Q2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Understand</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Explainable answers with shared context</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Q3</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Decide</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Repeatable workflows and approvals</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Q4</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Scale</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Portfolio visibility and automation</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>

    <w:p><w:pPr><w:pStyle w:val="SectionLabel"/></w:pPr><w:r><w:t>03  •  OPERATING PLAN</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>From strategy to weekly execution</w:t></w:r></w:p>
    <w:p><w:r><w:t>Execution will run through cross-functional outcome teams with one accountable lead, a measurable customer result, and a six-week learning cadence. Product, design, engineering, data, go-to-market, and customer success will share the same scorecard.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Operating principles</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="420" w:hanging="300"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="20639B"/></w:rPr><w:t>01</w:t></w:r><w:r><w:t xml:space="preserve">   Start with the customer decision, not the feature request.</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="420" w:hanging="300"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="20639B"/></w:rPr><w:t>02</w:t></w:r><w:r><w:t xml:space="preserve">   Instrument adoption and quality before broad release.</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="420" w:hanging="300"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="20639B"/></w:rPr><w:t>03</w:t></w:r><w:r><w:t xml:space="preserve">   Prefer a coherent workflow over a larger menu of capabilities.</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="420" w:hanging="300"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="20639B"/></w:rPr><w:t>04</w:t></w:r><w:r><w:t xml:space="preserve">   Publish decisions and evidence where every team can find them.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Leadership decisions required</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:color w:val="20639B"/><w:b/></w:rPr><w:t>☐</w:t></w:r><w:r><w:t xml:space="preserve">  Confirm FY 2026 investment envelope and hiring sequence.</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:color w:val="20639B"/><w:b/></w:rPr><w:t>☐</w:t></w:r><w:r><w:t xml:space="preserve">  Approve the three company-level outcome metrics.</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:color w:val="20639B"/><w:b/></w:rPr><w:t>☐</w:t></w:r><w:r><w:t xml:space="preserve">  Name executive sponsors for the first two outcome teams.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>Next review: September 9, 2026  •  Owner: Maya Chen, VP Product</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Small"/><w:spacing w:before="360"/></w:pPr><w:r><w:t>This brief is a working document. Use comments for questions and Suggesting mode for proposed changes.</w:t></w:r></w:p>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:footerReference w:type="default" r:id="rId3"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1260" w:bottom="1080" w:left="1260" w:header="540" w:footer="540" w:gutter="0"/>
      <w:pgNumType w:start="1"/>
    </w:sectPr>
  </w:body>
</w:document>`;

export function productStrategyFile(): File {
  const bytes = zipStore({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": packageRelationships,
    "word/document.xml": documentXml,
    "word/styles.xml": styles,
    "word/_rels/document.xml.rels": documentRelationships,
    "word/header1.xml": header,
    "word/footer1.xml": footer,
  });
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], "Product Strategy Brief.docx", {
    type: CONTENT_TYPE,
  });
}
