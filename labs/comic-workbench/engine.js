/* MIRROR × HIMIKO Comic Workbench — original implementation; no third-party source copied. */
(function (root, make) {
  "use strict";
  const api = make();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ComicWorkbench = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const VERSION = "comic-workbench/v1";
  const EDITABLE = new Set(["scene", "phase", "cast", "requiredCast", "lines", "requiredProps",
    "visibleProps", "requiredClues", "visibleClues", "hiddenClues", "historicalClaims",
    "visualChecks", "assetRef"]);
  const CHECKS = ["identity", "bubbleSpeaker", "storyLogic", "visualEvidence"];
  const BASES = ["primary_source", "archaeology", "reconstruction", "fiction"];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const str = (x) => typeof x === "string";
  const words = (x) => Array.isArray(x) && x.every(str);
  const issue = (severity, code, pageId, panelId, message) =>
    ({ severity, code, pageId, panelId, message });

  function assertDocument(doc) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw Error("JSONのルートが不正です");
    if (doc.schema !== VERSION) throw Error("未対応のスキーマです: " + String(doc.schema));
    if (!["mirror", "himiko"].includes(doc.project)) throw Error("作品IDが不正です");
    if (!str(doc.title) || doc.title.length > 300) throw Error("タイトルが不正です");
    if (!doc.canon || !str(doc.canon.reference) || !Array.isArray(doc.canon.characters)) {
      throw Error("参照用Canonの形式が不正です");
    }
    if (doc.canon.characters.length > 100) throw Error("人物数が多すぎます");
    const people = new Set();
    for (const c of doc.canon.characters) {
      if (!c || !str(c.id) || !str(c.name) || !str(c.role) || !c.id || people.has(c.id)) {
        throw Error("人物IDの形式または重複が不正です");
      }
      people.add(c.id);
    }
    if (!Array.isArray(doc.pages) || doc.pages.length > 30) throw Error("ページ形式が不正です");
    const ids = new Set();
    let count = 0;
    for (const page of doc.pages) {
      if (!page || !str(page.id) || !Array.isArray(page.panels)) throw Error("ページ構造が不正です");
      for (const p of page.panels) {
        count++;
        if (count > 200) throw Error("コマ数が多すぎます");
        if (!p || !str(p.id) || !p.id || ids.has(p.id) || !str(p.scene)
            || !["draft", "approved"].includes(p.status)
            || !["setup", "investigation", "reveal"].includes(p.phase)
            || !words(p.cast) || !words(p.requiredCast) || !words(p.requiredProps)
            || !words(p.visibleProps) || !words(p.requiredClues)
            || !words(p.visibleClues) || !words(p.hiddenClues)
            || !Array.isArray(p.lines) || !Array.isArray(p.historicalClaims)
            || !str(p.assetRef) || !p.visualChecks || typeof p.visualChecks !== "object"
            || !Number.isInteger(p.revision) || p.revision < 0) {
          throw Error("コマの形式が不正です: " + String(p && p.id));
        }
        for (const l of p.lines) if (!l || !str(l.speaker) || !str(l.text) || !str(l.target)) {
          throw Error("セリフ構造が不正です: " + p.id);
        }
        for (const h of p.historicalClaims) if (!h || !str(h.subject)
          || !str(h.basis) || !str(h.source)) throw Error("考証構造が不正です");
        for (const key of CHECKS) if (typeof p.visualChecks[key] !== "boolean") {
          throw Error("目視検査フラグが不正です");
        }
        ids.add(p.id);
      }
    }
    if (doc.audit !== undefined && (!Array.isArray(doc.audit) || doc.audit.length > 500)) {
      throw Error("監査履歴形式が不正です");
    }
    return true;
  }

  function locate(doc, panelId) {
    for (const page of doc.pages) {
      const index = page.panels.findIndex(p => p.id === panelId);
      if (index >= 0) return { page, index, panel: page.panels[index] };
    }
    throw Error("対象コマが見つかりません");
  }

  // Strict compare to the FACTORY source snapshot, not to mutable display text.
  // A snapshot is a local evidence record, not a cryptographic proof of Canon.
  function sourceReport(doc, panelId) {
    assertDocument(doc);
    const origin = doc.sourceInfo;
    if (!origin) return { status: "NOT_IMPORTED", mismatches: [], verified: false };
    const mismatch = [];
    const add = (message) => mismatch.push(message);
    if (origin.origin !== "mirror_factory_os_v09" ||
        !Array.isArray(origin.originalSourceLines) ||
        !Array.isArray(origin.expectedPanels) ||
        !Array.isArray(origin.speakerBindings) ||
        origin.originalSourceLines.length > 400 ||
        typeof origin.originalLocked !== "boolean") {
      return { status: "SOURCE_UNVERIFIED", mismatches: ["原稿の参照情報が不足しています"], verified: false };
    }
    const signature = (lines) => {
      let h = 2166136261 >>> 0;
      const text = JSON.stringify(lines);
      for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return h.toString(16).padStart(8, "0");
    };
    if (!origin.originalSourceLines.every(line => Array.isArray(line) && line.length === 2 &&
        typeof line[0] === "string" && typeof line[1] === "string")) {
      return { status: "SOURCE_UNVERIFIED", mismatches: ["元原稿の行情報が不正です"], verified: false };
    }
    const originalHash = signature(origin.originalSourceLines);
    const hashVerified = origin.originalLocked === true &&
      typeof origin.sourceLockHash === "string" && origin.sourceLockHash === originalHash;
    if (!hashVerified) add("元原稿のSOURCE LOCK署名が存在しないか、整合していません");
    const expected = origin.expectedPanels.find(x => x && x.id === panelId);
    if (!expected || !Array.isArray(expected.lines) || !Array.isArray(expected.indices)) {
      add("このコマに対応する元原稿の参照がありません");
      return { status: "SOURCE_UNVERIFIED", mismatches: mismatch, verified: false };
    }
    const panels = doc.pages.flatMap(pg => pg.panels);
    const panel = panels.find(p => p.id === panelId);
    if (!panel) add("対象コマが存在しません");
    const lines = panel?.lines || [];
    if (expected.indices.length !== expected.lines.length || expected.lines.length !== lines.length) {
      add("確定セリフの行数が変更されています");
    }
    const same = expected.lines.length === lines.length &&
      expected.lines.every((line,i) => line &&
        typeof line.speaker === "string" && typeof line.text === "string" &&
        lines[i].speaker === line.speaker && lines[i].text === line.text);
    if (!same) add("確定セリフの話者・本文・順序が元原稿と一致しません");
    const indexed = expected.indices.every((idx,i) => Number.isInteger(idx) && idx >= 0 &&
      idx < origin.originalSourceLines.length);
    if (!indexed) add("元原稿の対応行番号が不正です");
    const signaturesMatch = indexed && expected.indices.length === expected.lines.length &&
      origin.speakerBindings.length === origin.originalSourceLines.length &&
      expected.indices.every((idx,i) => {
        const raw = origin.originalSourceLines[idx], binding = origin.speakerBindings[idx];
        return raw && binding && typeof binding.speaker === "string" &&
          raw[0] === binding.literal &&
          expected.lines[i]?.speaker === binding.speaker &&
          expected.lines[i]?.text === raw[1];
      });
    if (!signaturesMatch) add("コピー時の話者ID対応／確定原稿本文の記録が一致しません");
    const flat = origin.expectedPanels.flatMap(p => p?.indices || []);
    if (flat.length !== origin.originalSourceLines.length ||
        flat.some((n,i) => n !== i)) add("元原稿の行割付に欠落・重複・順序違いがあります");
    const ids = origin.expectedPanels.map(p => p.id);
    if (new Set(ids).size !== ids.length) add("参照元コマの識別子が重複しています");
    const diverged = mismatch.some(m => !m.includes("SOURCE LOCK署名"));
    const status = diverged ? "DIVERGED" : hashVerified ? "MATCH" : "SOURCE_UNVERIFIED";
    return { status, mismatches: mismatch, verified: status === "MATCH",
      originalHash, recordedHash: origin.sourceLockHash || null,
      panelId, comparedLines: lines.length };
  }

  function inspectPanel(doc, page, p) {
    const out = [];
    const add = (severity, code, message) => out.push(issue(severity, code, page.id, p.id, message));
    const map = new Map(doc.canon.characters.map(c => [c.id, c]));
    for (const id of p.cast) if (!map.has(id)) add("ERROR", "UNREGISTERED_CAST", "未登録人物: " + id);
    for (const id of p.requiredCast) if (!p.cast.includes(id)) add("ERROR", "MISSING_CHARACTER", "必要な人物が不在: " + id);
    for (const l of p.lines) {
      if (!l.text.trim()) add("WARN", "EMPTY_DIALOGUE", "空のセリフがあります");
      if (!p.cast.includes(l.speaker)) add("ERROR", "SPEAKER_NOT_PRESENT", "発話者が登場人物にいません: " + l.speaker);
      if (l.target && !p.cast.includes(l.target)) add("WARN", "TARGET_NOT_PRESENT", "会話の相手がそのコマにいません: " + l.target);
      const role = map.get(l.speaker) && map.get(l.speaker).role;
      if (/責任者.{0,4}呼んで/.test(l.text) && role === "staff") {
        add("WARN", "ROLE_CONTEXT", "責任者を呼ぶ要求の発話者を確認してください");
      }
      if (/申し訳ございません/.test(l.text) && role === "customer") {
        add("WARN", "ROLE_CONTEXT", "謝罪セリフの話者を確認してください");
      }
    }
    for (const x of p.requiredProps) if (!p.visibleProps.includes(x)) {
      add("ERROR", "MISSING_PROP", "必要な小道具が未確認: " + x);
    }
    for (const x of p.requiredClues) if (!p.visibleClues.includes(x)) {
      add("ERROR", "MISSING_CLUE", "必要な手掛かりが未確認: " + x);
    }
    if (p.phase !== "reveal") for (const x of p.hiddenClues) if (p.visibleClues.includes(x)) {
      add("ERROR", "PREMATURE_REVEAL", "公開前の証拠が出ています: " + x);
    }
    if (doc.project === "himiko") {
      for (const h of p.historicalClaims) {
        if (!BASES.includes(h.basis)) add("ERROR", "HISTORY_UNCLASSIFIED", "考証区分が未設定: " + h.subject);
        if (h.basis !== "fiction" && !h.source.trim()) {
          add("WARN", "HISTORY_SOURCE_MISSING", "出典未登録: " + h.subject);
        }
      }
    }
    if (doc.sourceInfo) {
      const source = sourceReport(doc, p.id);
      if (source.status !== "MATCH") {
        add(source.status === "DIVERGED" ? "ERROR" : "WARN",
          "SOURCE_LOCK_" + source.status,
          "FACTORY OS原稿との差分／参照確認: " + (source.mismatches.join("／") || source.status));
      }
    }
    if (!p.assetRef.trim()) add("WARN", "IMAGE_UNLINKED", "作画画像の参照先が未設定です");
    for (const key of CHECKS) if (!p.visualChecks[key]) {
      add("WARN", "MANUAL_QA_PENDING", "人による目視確認が未完了: " + key);
    }
    return out;
  }

  function inspect(doc) {
    assertDocument(doc);
    return doc.pages.flatMap(page => page.panels.flatMap(p => inspectPanel(doc, page, p)));
  }

  function panelReport(doc, panelId) {
    assertDocument(doc);
    const { page, panel } = locate(doc, panelId);
    return inspectPanel(doc, page, panel);
  }

  function edit(doc, panelId, patch) {
    assertDocument(doc);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)
        || !Object.keys(patch).length || Object.keys(patch).some(k => !EDITABLE.has(k))) {
      throw Error("許可されていない変更項目が含まれています");
    }
    const result = copy(doc);
    const { page, index, panel } = locate(result, panelId);
    if (panel.status === "approved") throw Error("承認済みコマは変更できません。新しい草稿に複製してください");
    const before = copy(panel);
    for (const [key, val] of Object.entries(patch)) panel[key] = copy(val);
    // Any changed visual or story source invalidates all previous manual approvals.
    const meaningful = ["scene","phase","cast","requiredCast","lines","requiredProps",
      "visibleProps","requiredClues","visibleClues","hiddenClues","historicalClaims","assetRef"];
    if (meaningful.some(key => JSON.stringify(before[key]) !== JSON.stringify(panel[key]))) {
      panel.visualChecks = Object.fromEntries(CHECKS.map(k => [k, false]));
    }
    panel.revision++;
    result.audit = result.audit || [];
    if (result.audit.length >= 500) throw Error("監査履歴が上限です。JSONを書き出して新規作業を始めてください");
    result.audit.push({ action: "edit", panelId, revision: panel.revision, previous: before });
    page.panels[index] = panel;
    assertDocument(result);
    return result;
  }

  function undo(doc) {
    assertDocument(doc);
    const result = copy(doc);
    const latest = result.audit && result.audit[result.audit.length - 1];
    if (!latest || latest.action !== "edit") throw Error("取り消せる直前の編集がありません");
    const { page, index, panel } = locate(result, latest.panelId);
    if (panel.status === "approved" || panel.revision !== latest.revision) {
      throw Error("この編集は安全に取り消せません");
    }
    page.panels[index] = copy(latest.previous);
    result.audit.pop();
    assertDocument(result);
    return result;
  }

  function approve(doc, panelId) {
    assertDocument(doc);
    const result = copy(doc);
    const { panel, page } = locate(result, panelId);
    if (panel.status !== "draft") throw Error("承認済みです");
    if (result.sourceInfo && sourceReport(result, panelId).status !== "MATCH") {
      throw Error("元原稿のSOURCE LOCK照合が未合格です。話者・セリフを元に戻し、要確認情報を解消してください");
    }
    const errors = inspectPanel(result, page, panel).filter(x => x.severity === "ERROR");
    if (errors.length) throw Error("未解決のERRORがあります (" + errors.length + "件)");
    if (!panel.assetRef.trim() || CHECKS.some(k => !panel.visualChecks[k])) {
      throw Error("画像参照と4種類の人による目視チェックが必要です");
    }
    panel.status = "approved";
    result.audit = result.audit || [];
    if (result.audit.length >= 500) throw Error("監査履歴が上限です");
    result.audit.push({ action: "approve", panelId, revision: panel.revision });
    return result;
  }

  function forkDraft(doc, panelId) {
    assertDocument(doc);
    const result = copy(doc);
    const { page, index, panel } = locate(result, panelId);
    if (panel.status !== "approved") throw Error("複製は承認済みコマからのみ可能です");
    let i = 2;
    while (result.pages.some(pg => pg.panels.some(p => p.id === panel.id + "-draft" + i))) i++;
    const fork = copy(panel);
    fork.id = panel.id + "-draft" + i;
    fork.status = "draft";
    fork.revision = 0;
    fork.visualChecks = Object.fromEntries(CHECKS.map(k => [k, false]));
    page.panels.splice(index + 1, 0, fork);
    result.audit = result.audit || [];
    if (result.audit.length >= 500) throw Error("監査履歴が上限です");
    result.audit.push({ action: "fork", panelId: fork.id, from: panelId });
    assertDocument(result);
    return { document: result, newPanelId: fork.id };
  }

  function restoreSourceLines(doc, panelId) {
    assertDocument(doc);
    if (!doc.sourceInfo) throw Error("FACTORY原稿から取り込んだデータではありません");
    const expected = doc.sourceInfo.expectedPanels?.find(x => x.id === panelId);
    if (!expected || !Array.isArray(expected.lines)) throw Error("元原稿との対応がありません");
    return edit(doc, panelId, {
      lines: expected.lines.map(l => ({ speaker: l.speaker, target: "", text: l.text }))
    });
  }

  function promptFor(doc, panelId) {
    assertDocument(doc);
    const { panel: p } = locate(doc, panelId);
    if (doc.sourceInfo && sourceReport(doc, panelId).status !== "MATCH") {
      throw Error("元原稿との照合が未合格です。改変済みのセリフを作画指示に転記できません");
    }
    const byId = new Map(doc.canon.characters.map(c => [c.id, c]));
    return [
      "【コマ単位の作画指示・ドラフト】", "作品: " + doc.project + " / " + doc.title,
      "正式MASTER参照（変更禁止）: " + doc.canon.reference,
      "対象コマ: " + p.id, "状況: " + p.scene, "段階: " + p.phase,
      "登場人物: " + p.cast.map(id => byId.has(id) ? byId.get(id).name + " (" + id + ")" : id).join("、"),
      "必要な小道具: " + p.requiredProps.join("、"),
      "必要な手掛かり: " + p.requiredClues.join("、"),
      "この段階で見せない証拠: " + (p.phase === "reveal" ? "公開段階" : p.hiddenClues.join("、")),
      "セリフ（文字完全一致、話者・相手・吹き出し尻尾を検証）:",
      ...p.lines.map(l => "- " + l.speaker + " → " + l.target + ": " + l.text),
      ...(doc.project === "himiko" ? ["考証登録:", ...p.historicalClaims.map(h =>
        "- " + h.subject + " / " + h.basis + " / " + (h.source || "出典未確認"))] : []),
      "人物同一性・因果関係・伏線提示のタイミングを維持。承認済み他コマは一切変更しない。",
      "※画像生成は未接続。これは制作指示書であり、視覚検査済みの証明ではない。"
    ].join("\n");
  }

  function makePanel(id, scene, cast, lines, extra) {
    return Object.assign({
      id, scene, phase: "investigation", cast, requiredCast: [...cast], lines,
      requiredProps: [], visibleProps: [], requiredClues: [], visibleClues: [],
      hiddenClues: [], historicalClaims: [], visualChecks: {
        identity: false, bubbleSpeaker: false, storyLogic: false, visualEvidence: false
      }, assetRef: "", status: "draft", revision: 0
    }, extra || {});
  }
  function demo(project) {
    if (project === "himiko") return {
      schema: VERSION, project, title: "卑弥呼の声 — 検証用サンプル（非Canon）",
      canon: { reference: "承認済みサネCHARACTER MASTER／考証資料（未インポート・要照合）",
        characters: [{ id: "sane", name: "サネ", role: "villager" }, { id: "himiko", name: "卑弥呼", role: "leader" }] },
      pages: [{ id: "H-DEMO", panels: [
        makePanel("H01", "村でサネが異変に気付く。具体的な風俗・建築は出典確認前に確定しない。", ["sane"], [], {
          historicalClaims: [{ subject: "村の建物描写", basis: "reconstruction", source: "" }] }),
        makePanel("H02", "サネが卑弥呼へ不穏な出来事を伝える。", ["sane", "himiko"],
          [{ speaker: "sane", target: "himiko", text: "聞いて。村で気になるものを見たの。" }]) ] }],
      audit: []
    };
    return {
      schema: VERSION, project: "mirror", title: "PROJECT MIRROR — 検証用サンプル（非Canon）",
      canon: { reference: "既存CHARACTER MASTER／PAGE MASTER（未インポート・要照合）",
        characters: [{ id: "guest", name: "来店客（デモ）", role: "customer" },
          { id: "staff", name: "店員（デモ）", role: "staff" }] },
      pages: [{ id: "M-DEMO", panels: [
        makePanel("P01", "客が店員に声を掛ける。", ["guest", "staff"],
          [{ speaker: "guest", target: "staff", text: "責任者を呼んでください。" }]),
        makePanel("P02", "店員が頭を下げる。", ["guest", "staff"],
          [{ speaker: "staff", target: "guest", text: "申し訳ございません。" }]),
        makePanel("P03", "名札が後の事件の伏線になる（検査用に不足を残す）。", ["guest", "staff"], [],
          { requiredProps: ["名札"], requiredClues: ["名札の記号"] })
      ] }], audit: []
    };
  }
  return { VERSION, CHECKS, BASES, assertDocument, inspect, panelReport, edit, undo,
    approve, forkDraft, promptFor, sourceReport, restoreSourceLines, demo };
});
