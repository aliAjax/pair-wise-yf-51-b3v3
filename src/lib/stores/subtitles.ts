import { browser } from "$app/environment";
import { derived, get, writable } from "svelte/store";

export type TrackStatus = "草稿" | "审校中" | "已通过" | "需修改";
export type CueStatus = "待译" | "翻译中" | "待审" | "已通过" | "退回" | "冲突待定";
export type TermStatus = "建议" | "已锁定";

export interface Track {
  id: string;
  name: string;
  locale: "zh" | "en" | "ja";
  status: TrackStatus;
}

export interface CueVersion {
  id: string;
  author: string;
  text: string;
  time: string;
  origin: "本地" | "协作" | "合并";
  chosen?: boolean;
  archived?: boolean;
}

export interface Cue {
  id: string;
  trackId: string;
  start: number;
  end: number;
  source: string;
  translated: string;
  status: CueStatus;
  translator: string;
  reviewerNote: string;
  /** 各译员留存的译文版本；同一条被两人改过且分叉时，各留一版等待审校定夺 */
  versions: CueVersion[];
  /** 最近一次与服务端对齐的译文，作为离线合并的分叉基准 */
  baseText?: string;
  /** 离线拆分时记录父条 */
  splitParentId?: string;
  /** 术语改版后旧的审校结论失效，需重新确认 */
  needsConfirm?: boolean;
}

export interface TermRevision {
  target: string;
  owner: string;
  time: string;
  note: string;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  status: TermStatus;
  owner: string;
  updatedAt: string;
  /** 旧译名留档，术语改版后可追溯 */
  history: TermRevision[];
}

export interface ApprovalArchive {
  id: string;
  cueId: string;
  approvedText: string;
  reviewer: string;
  approvedAt: string;
  invalidatedAt: string;
  reason: string;
}

export type IssueCategory = "术语" | "超长" | "错译" | "时间码" | "其他";

export interface IssueReport {
  id: string;
  cueId: string;
  reporter: string;
  category: IssueCategory;
  detail: string;
  time: string;
  dedupeKey: string;
  /** 同一处重复上报只算一次：重复者挂这里，不新增记录 */
  duplicates: { reporter: string; time: string }[];
}

export type SyncOpType = "edit" | "split";

export interface SyncOp {
  id: string;
  type: SyncOpType;
  cueId: string;
  author: string;
  time: string;
  blockedReason?: string;
  // edit
  baseText?: string;
  text?: string;
  // split
  splitId?: string;
  middle?: number;
  secondText?: string;
}

export interface ReviewEvent {
  id: string;
  cueId: string;
  action:
    | "提交审校"
    | "审校通过"
    | "退回修改"
    | "术语锁定"
    | "术语改版"
    | "提交拦截"
    | "审校失效"
    | "版本定夺"
    | "重复上报"
    | "同步合并";
  detail: string;
  actor: string;
  time: string;
}

export interface Snapshot {
  id: string;
  name: string;
  time: string;
  cues: Cue[];
}

export interface TimelineConflict {
  id: string;
  cueId: string;
  message: string;
  remoteStart: number;
  remoteEnd: number;
  status: "待处理" | "采用本地" | "采用协作版本";
}

interface RemoteCue {
  id: string;
  trackId: string;
  start: number;
  end: number;
  source: string;
  translated: string;
  translator: string;
}

const KEY = "pair-wise-yf-51/subtitles-v2";
const SERVER_KEY = "pair-wise-yf-51/mock-server-v1";

const TERM_ADMIN = "术语管理员";
export const ACTORS = ["林岚", "周野", "顾宁（审校）", TERM_ADMIN] as const;

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

const seedTracks: Track[] = [
  { id: "zh", name: "中文原字幕", locale: "zh", status: "已通过" },
  { id: "en", name: "English 翻译", locale: "en", status: "审校中" },
  { id: "ja", name: "日本語訳", locale: "ja", status: "草稿" }
];

function version(author: string, text: string, origin: CueVersion["origin"] = "本地"): CueVersion {
  return { id: uid(), author, text, time: now(), origin };
}

const seedCues: Cue[] = [
  {
    id: "c1", trackId: "zh", start: 0, end: 2.8,
    source: "潮汐退去后，码头重新露出水面。",
    translated: "潮汐退去后，码头重新露出水面。",
    status: "已通过", translator: "系统", reviewerNote: "",
    versions: [], baseText: "潮汐退去后，码头重新露出水面。"
  },
  {
    id: "c2", trackId: "en", start: 0, end: 2.8,
    source: "潮汐退去后，码头重新露出水面。",
    translated: "As the tide recedes, the pier emerges again.",
    status: "待审", translator: "林岚", reviewerNote: "",
    versions: [version("林岚", "As the tide recedes, the pier emerges again.")],
    baseText: "As the tide recedes, the pier emerges again."
  },
  {
    id: "c3", trackId: "en", start: 3.2, end: 6.5,
    source: "修复组必须在下一场潮水到来前完成加固。",
    translated: "The repair team must reinforce it before the next tide.",
    status: "翻译中", translator: "林岚", reviewerNote: "",
    versions: [version("林岚", "The repair team must reinforce it before the next tide.")],
    baseText: "The repair team must reinforce it before the next tide."
  },
  {
    id: "c4", trackId: "ja", start: 0, end: 2.8,
    source: "潮汐退去后，码头重新露出水面。",
    translated: "潮が引くと、桟橋が再び姿を現す。",
    status: "待译", translator: "周野", reviewerNote: "",
    versions: [version("周野", "潮が引くと、桟橋が再び姿を現す。")],
    baseText: "潮が引くと、桟橋が再び姿を現す。"
  }
];

const seedTerms: GlossaryTerm[] = [
  { id: "g1", source: "潮汐", target: "tide", status: "已锁定", owner: TERM_ADMIN, updatedAt: now(), history: [] },
  { id: "g2", source: "码头", target: "pier", status: "已锁定", owner: TERM_ADMIN, updatedAt: now(), history: [] },
  { id: "g3", source: "加固", target: "reinforce", status: "建议", owner: "林岚", updatedAt: now(), history: [] }
];

function seedServer(): Record<string, RemoteCue> {
  return Object.fromEntries(
    seedCues
      .filter((cue) => cue.trackId !== "zh" || cue.id === "c1")
      .map((cue) => [cue.id, {
        id: cue.id, trackId: cue.trackId, start: cue.start, end: cue.end,
        source: cue.source, translated: cue.baseText ?? cue.translated, translator: cue.translator
      }])
  );
}

interface Persisted {
  tracks: Track[];
  cues: Cue[];
  terms: GlossaryTerm[];
  events: ReviewEvent[];
  snapshots: Snapshot[];
  reports: IssueReport[];
  pending: SyncOp[];
  archives: ApprovalArchive[];
  actor: string;
}

const initial: Persisted | null =
  browser && localStorage.getItem(KEY) ? JSON.parse(localStorage.getItem(KEY)!) : null;

export const tracks = writable<Track[]>(initial?.tracks ?? seedTracks);
export const cues = writable<Cue[]>(initial?.cues ?? seedCues);
export const terms = writable<GlossaryTerm[]>(initial?.terms ?? seedTerms);
export const reviewEvents = writable<ReviewEvent[]>(initial?.events ?? []);
export const snapshots = writable<Snapshot[]>(initial?.snapshots ?? []);
export const reports = writable<IssueReport[]>(initial?.reports ?? []);
export const pendingOps = writable<SyncOp[]>(initial?.pending ?? []);
export const approvalArchives = writable<ApprovalArchive[]>(initial?.archives ?? []);
export const actor = writable(initial?.actor ?? "林岚");
export const online = writable(true);
export const syncing = writable(false);
export const lastSyncTime = writable("");

export const conflicts = writable<TimelineConflict[]>([
  { id: "x1", cueId: "c2", message: "协作者将结束时间调整为3.0秒，与本机存在0.2秒差异。", remoteStart: 0, remoteEnd: 3, status: "待处理" }
]);
export const activeTrackId = writable("en");
export const selectedCueId = writable("c2");
export const reviewer = writable("审校-顾宁");

function persist() {
  if (!browser) return;
  const data: Persisted = {
    tracks: get(tracks),
    cues: get(cues),
    terms: get(terms),
    events: get(reviewEvents),
    snapshots: get(snapshots),
    reports: get(reports),
    pending: get(pendingOps),
    archives: get(approvalArchives),
    actor: get(actor)
  };
  localStorage.setItem(KEY, JSON.stringify(data));
}

[tracks, cues, terms, reviewEvents, snapshots, reports, pendingOps, approvalArchives, actor]
  .forEach((store) => store.subscribe(persist));

function readServer(): Record<string, RemoteCue> {
  if (!browser) return {};
  const raw = localStorage.getItem(SERVER_KEY);
  if (raw) return JSON.parse(raw);
  const seeded = seedServer();
  localStorage.setItem(SERVER_KEY, JSON.stringify(seeded));
  return seeded;
}

function writeServer(server: Record<string, RemoteCue>) {
  if (browser) localStorage.setItem(SERVER_KEY, JSON.stringify(server));
}

function log(cueId: string, action: ReviewEvent["action"], detail: string, who = get(actor)) {
  reviewEvents.update((items) => [{ id: uid(), cueId, action, detail, actor: who, time: now() }, ...items]);
}

// ---------- 术语锁定保护 ----------

/** 锁定术语：当前锁定译名必须出现在译文中，普通译文不允许盖掉 */
export function lockedTermViolations(text: string): GlossaryTerm[] {
  return get(terms).filter(
    (term) => term.status === "已锁定" && text.length > 0 && !text.includes(term.target)
  );
}

export function updateCue(id: string, patch: Partial<Cue>) {
  cues.update((items) => items.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)));
}

/**
 * 译员改译文：本机立即生效（断网也能改），同时挂入待同步队列。
 * 同一条的连续编辑合并成一条队列项，网络恢复后只提交最终版本。
 */
export function editTranslation(id: string, text: string) {
  updateCue(id, { translated: text });
  const cue = get(cues).find((item) => item.id === id);
  if (!cue || cue.trackId === "zh") return;

  pendingOps.update((ops) => {
    const existing = ops.find((op) => op.type === "edit" && op.cueId === id && !op.blockedReason);
    if (existing) {
      return ops.map((op) => (op === existing ? { ...op, text, time: now(), blockedReason: undefined } : op));
    }
    // 之前被拦截的同条编辑：新稿到达后解除阻塞，重新入队待合并
    const blocked = ops.find((op) => op.type === "edit" && op.cueId === id);
    if (blocked) {
      return ops.map((op) => (op === blocked ? { ...op, text, time: now(), blockedReason: undefined } : op));
    }
    return [...ops, {
      id: uid(), type: "edit", cueId: id,
      baseText: cue.baseText ?? cue.translated,
      text, author: get(actor), time: now()
    }];
  });

  if (get(online)) void syncNow();
}

export function nudgeCue(id: string, delta: number) {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  updateCue(id, {
    start: Math.max(0, Number((cue.start + delta).toFixed(1))),
    end: Math.max(cue.start + 0.5, Number((cue.end + delta).toFixed(1)))
  });
}

/** 拆分字幕条：断网时本机先拆，操作入队，联网后并入同一条时间轴 */
export function splitCue(id: string) {
  const list = get(cues);
  const cue = list.find((item) => item.id === id);
  if (!cue || cue.end - cue.start < 1) return;

  const middle = Number(((cue.start + cue.end) / 2).toFixed(1));
  const splitId = uid();
  const first: Cue = { ...cue, end: middle, status: "翻译中" };
  const second: Cue = {
    ...cue, id: splitId, start: middle, translated: "",
    status: "待译", versions: [], baseText: "", splitParentId: cue.id,
    reviewerNote: ""
  };
  cues.set(list.flatMap((item) => (item.id === id ? [first, second] : item)));
  selectedCueId.set(splitId);

  if (cue.trackId !== "zh") {
    pendingOps.update((ops) => [...ops, {
      id: uid(), type: "split", cueId: id, splitId, middle,
      secondText: "", author: get(actor), time: now()
    }]);
    if (get(online)) void syncNow();
  }
}

/** 合并相邻条需要服务端协调，断网时禁用 */
export function mergeNext(id: string): { ok: boolean; reason?: string } {
  if (!get(online)) return { ok: false, reason: "断网状态下请先拆分/改译文，恢复网络后再合并时间轴。" };
  const list = [...get(cues)].sort((a, b) => a.start - b.start).filter((item) => item.trackId === get(activeTrackId));
  const index = list.findIndex((item) => item.id === id);
  const current = list[index];
  const next = list[index + 1];
  if (!current || !next) return { ok: false, reason: "后面没有可合并的字幕条。" };
  cues.update((items) => items
    .filter((item) => item.id !== next.id)
    .map((item) => (item.id === id
      ? { ...item, end: next.end, translated: `${item.translated} ${next.translated}`.trim(), status: "翻译中" }
      : item)));
  const server = readServer();
  if (server[id]) {
    server[id].end = next.end;
    server[id].translated = `${current.translated} ${next.translated}`.trim();
    delete server[next.id];
    writeServer(server);
  }
  return { ok: true };
}

// ---------- 审校 ----------

export function setCueStatus(id: string, status: CueStatus): { ok: boolean; reason?: string } {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return { ok: false };
  if (status === "待审") {
    const violations = lockedTermViolations(cue.translated);
    if (violations.length) {
      const reason = `锁定术语未采用：${violations.map((t) => `${t.source}→${t.target}`).join("、")}，普通译文不能盖过术语库。`;
      log(id, "提交拦截", reason);
      return { ok: false, reason };
    }
  }
  updateCue(id, { status });
  log(id, status === "待审" ? "提交审校" : "退回修改", cue.translated);
  return { ok: true };
}

export function reviewCue(id: string, approved: boolean, note = "") {
  const cue = get(cues).find((item) => item.id === id);
  if (!cue) return;
  updateCue(id, {
    status: approved ? "已通过" : "退回",
    reviewerNote: note,
    needsConfirm: approved ? false : cue.needsConfirm
  });
  log(id, approved ? "审校通过" : "退回修改", note || cue.translated);
}

// ---------- 术语库 ----------

export function lockTerm(id: string) {
  terms.update((items) => items.map((term) =>
    term.id === id ? { ...term, status: "已锁定", owner: TERM_ADMIN } : term));
  const term = get(terms).find((item) => item.id === id);
  log(get(selectedCueId), "术语锁定", `${term?.source} → ${term?.target}`);
}

/**
 * 锁定术语改版：
 * 旧译名与旧审校结论留档；所有含旧译名的已通过字幕审校结论立即失效，退回待重新确认。
 */
export function reviseTerm(id: string, newTarget: string, note = ""): { ok: boolean; reason?: string } {
  if (get(actor) !== TERM_ADMIN) {
    return { ok: false, reason: "只有术语管理员可以修改锁定术语。" };
  }
  const term = get(terms).find((item) => item.id === id);
  if (!term) return { ok: false, reason: "术语不存在。" };
  const trimmed = newTarget.trim();
  if (!trimmed) return { ok: false, reason: "新译名不能为空。" };
  if (trimmed === term.target) return { ok: false, reason: "新译名与当前译名相同。" };

  const oldTarget = term.target;
  const archivedAt = now();

  terms.update((items) => items.map((item) => item.id === id
    ? {
        ...item,
        target: trimmed,
        updatedAt: archivedAt,
        history: [...item.history, { target: oldTarget, owner: term.owner, time: term.updatedAt, note }]
      }
    : item));
  log("", "术语改版", `「${term.source}」锁定译名 ${oldTarget} → ${trimmed}（旧译名已留档）。${note}`);

  const affected = get(cues).filter(
    (cue) => cue.trackId !== "zh" && cue.status === "已通过" && cue.translated.includes(oldTarget)
  );
  for (const cue of affected) {
    approvalArchives.update((items) => [{
      id: uid(),
      cueId: cue.id,
      approvedText: cue.translated,
      reviewer: get(reviewer),
      approvedAt: cue.versions.find((v) => v.chosen)?.time ?? "",
      invalidatedAt: archivedAt,
      reason: `锁定术语「${term.source}」改版：${oldTarget} → ${trimmed}，原审校结论失效，须重新确认。`
    }, ...items]);
    updateCue(cue.id, {
      status: "待审",
      needsConfirm: true,
      reviewerNote: `术语改版（${oldTarget} → ${trimmed}），原审校结论已失效，请重新确认。`
    });
    log(cue.id, "审校失效", `原通过译文留档：${cue.translated}`);
  }
  return { ok: true };
}

// ---------- 同条多版本：各留一版，审校定夺 ----------

/** 同一处分叉每位协作者只保留一版（新稿覆盖其旧稿），已留档版本不动 */
function pushVersion(cueId: string, v: CueVersion) {
  cues.update((items) => items.map((cue) => {
    if (cue.id !== cueId) return cue;
    const openBySameAuthor = cue.versions.filter((item) => !item.archived && item.author === v.author);
    if (openBySameAuthor.length) {
      return {
        ...cue,
        versions: cue.versions.map((item) =>
          item.id === openBySameAuthor[openBySameAuthor.length - 1].id
            ? { ...v, chosen: false }
            : item
        )
      };
    }
    return { ...cue, versions: [...cue.versions, v] };
  }));
}

export function resolveVersion(cueId: string, versionId: string) {
  const cue = get(cues).find((item) => item.id === cueId);
  const picked = cue?.versions.find((v) => v.id === versionId && !v.archived);
  if (!cue || !picked) return;
  cues.update((items) => items.map((item) => item.id === cueId
    ? {
        ...item,
        translated: picked.text,
        baseText: picked.text,
        translator: picked.author,
        status: "待审",
        reviewerNote: `审校已选定 ${picked.author} 的版本，落选版本已留档。`,
        versions: item.versions.map((v) => ({ ...v, chosen: v.id === versionId, archived: v.id === versionId ? false : true }))
      }
    : item));

  const server = readServer();
  if (server[cueId]) {
    server[cueId].translated = picked.text;
    server[cueId].translator = picked.author;
    writeServer(server);
  }
  log(cueId, "版本定夺", `采用 ${picked.author} 的版本：${picked.text}`);
  if (get(online)) void syncNow();
}

// ---------- 上报去重 ----------

export function reportIssue(cueId: string, category: IssueCategory, detail: string): { deduped: boolean } {
  const trimmed = detail.trim();
  const dedupeKey = `${cueId}|${category}|${trimmed}`;
  const existing = get(reports).find((item) => item.dedupeKey === dedupeKey);
  if (existing) {
    const who = get(actor);
    // 首报人自己的重复、以及已登记过的同一重复人都不再累计：同一处只算一次
    if (who !== existing.reporter && !existing.duplicates.some((d) => d.reporter === who)) {
      reports.update((items) => items.map((item) => item === existing
        ? { ...item, duplicates: [...item.duplicates, { reporter: who, time: now() }] }
        : item));
    }
    log(cueId, "重复上报", `「${category}：${trimmed}」已由 ${existing.reporter} 上报，只计一次。`);
    return { deduped: true };
  }
  reports.update((items) => [{
    id: uid(), cueId, reporter: get(actor), category, detail: trimmed,
    time: now(), dedupeKey, duplicates: []
  }, ...items]);
  return { deduped: false };
}

// ---------- 断网 / 恢复 / 同步合并 ----------

export function setOnline(value: boolean) {
  online.set(value);
  if (value) void syncNow();
}

/** 演示用：模拟协作者在另一台机器上改了同一条译文（制造分叉） */
export function simulateRemoteEdit(cueId: string, text: string, who = "周野") {
  const server = readServer();
  if (!server[cueId]) return;
  server[cueId].translated = text;
  server[cueId].translator = who;
  writeServer(server);
}

let syncChain: Promise<void> = Promise.resolve();

/** 串行化同步，避免联网瞬间与手动同步并发、重复消费队列 */
export function syncNow(): Promise<void> {
  if (!get(online) || !browser) return Promise.resolve();
  const run = syncChain.then(() => runSync());
  syncChain = run.catch(() => {});
  return run;
}

async function runSync() {
  if (get(syncing)) return;
  syncing.set(true);
  const server = readServer();
  const remaining: SyncOp[] = [];

  for (const op of get(pendingOps)) {
    const remote = server[op.cueId];

    if (!remote) {
      remaining.push({ ...op, blockedReason: "服务端找不到该字幕条，可能已被协作者移除。" });
      continue;
    }

    if (op.type === "edit") {
      const localText = op.text ?? "";
      const violations = get(terms).filter(
        (term) => term.status === "已锁定" && !localText.includes(term.target)
      );
      if (violations.length) {
        remaining.push({
          ...op,
          blockedReason: `合并被拒：锁定术语 ${violations.map((t) => `${t.source}→${t.target}`).join("、")} 未采用。`
        });
        continue;
      }

      if (remote.translated === op.baseText) {
        // 无分叉：本机改动直接快进合并到同一条时间轴
        remote.translated = localText;
        remote.translator = op.author;
        cues.update((items) => items.map((cue) => cue.id === op.cueId
          ? { ...cue, baseText: localText }
          : cue));
        log(op.cueId, "同步合并", `译文已并入共享时间轴（${op.author}）。`);
      } else {
        // 两人改过同一条：各留一版，状态置为冲突待定，等审校定夺
        pushVersion(op.cueId, { id: uid(), author: remote.translator, text: remote.translated, time: now(), origin: "协作" });
        pushVersion(op.cueId, { id: uid(), author: op.author, text: localText, time: now(), origin: "本地" });
        updateCue(op.cueId, { status: "冲突待定", translated: localText, reviewerNote: "本机与协作版本分叉，两版均已保留，请审校定夺。" });
        log(op.cueId, "同步合并", `与 ${remote.translator} 的修改分叉，两版各留一份等待定夺。`);
      }
    } else if (op.type === "split") {
      if (op.splitId && server[op.splitId]) {
        // 已应用过（幂等），直接确认
      } else if (op.middle! <= remote.start || op.middle! >= remote.end) {
        remaining.push({ ...op, blockedReason: "拆分点已落在协作时间码之外，请重新拆分。" });
        continue;
      } else {
        const splitId = op.splitId!;
        const originalEnd = remote.end;
        remote.end = op.middle!;
        server[splitId] = {
          id: splitId,
          trackId: remote.trackId,
          start: op.middle!,
          end: originalEnd,
          source: remote.source,
          translated: op.secondText ?? "",
          translator: op.author
        };
        log(op.cueId, "同步合并", `离线拆分的字幕条已并入共享时间轴。`);
      }
    }
  }

  writeServer(server);
  pendingOps.set(remaining);

  // 拉取服务端：无本机分叉的字幕快进到协作版本
  const pulled: Cue[] = [];
  for (const remote of Object.values(server)) {
    const local = get(cues).find((cue) => cue.id === remote.id);
    if (!local) {
      pulled.push({
        id: remote.id, trackId: remote.trackId, start: remote.start, end: remote.end,
        source: remote.source, translated: remote.translated, translator: remote.translator,
        status: "翻译中", reviewerNote: "协作者新增的字幕条。",
        versions: [version(remote.translator, remote.translated, "协作")], baseText: remote.translated
      });
      continue;
    }
    if (local.status === "冲突待定") {
      pulled.push({ ...local, start: remote.start, end: remote.end, source: remote.source });
      continue;
    }
    const hasPendingEdit = remaining.some((op) => op.type === "edit" && op.cueId === remote.id);
    if (!hasPendingEdit && remote.translated !== local.baseText) {
      pushVersion(remote.id, version(remote.translator, remote.translated, "协作"));
      pulled.push({
        ...local,
        translated: remote.translated,
        baseText: remote.translated,
        translator: remote.translator,
        start: remote.start, end: remote.end, source: remote.source,
        status: local.status === "已通过" ? "待审" : local.status,
        reviewerNote: local.status === "已通过" ? "协作者改动了译文，需重新审校。" : local.reviewerNote
      });
    } else {
      pulled.push({ ...local, start: remote.start, end: remote.end, source: remote.source });
    }
  }
  // 保留本机有、服务端没有的条（如离线拆分后还没被服务端接受）
  for (const local of get(cues)) {
    if (!server[local.id] && !pulled.some((cue) => cue.id === local.id)) pulled.push(local);
  }
  cues.set(pulled.sort((a, b) => a.start - b.start));

  lastSyncTime.set(now());
  await new Promise((resolve) => setTimeout(resolve, 250));
  syncing.set(false);
}

// ---------- 快照 / 时间轴冲突 ----------

export function createSnapshot(name = `时间轴快照 ${get(snapshots).length + 1}`) {
  snapshots.update((items) => [
    { id: uid(), name, time: now(), cues: structuredClone(get(cues)) },
    ...items
  ].slice(0, 12));
}

export function restoreSnapshot(id: string) {
  const snapshot = get(snapshots).find((item) => item.id === id);
  if (snapshot) cues.set(structuredClone(snapshot.cues));
}

export function resolveConflict(id: string, resolution: TimelineConflict["status"]) {
  conflicts.update((items) => items.map((item) => (item.id === id ? { ...item, status: resolution } : item)));
  if (resolution === "采用协作版本") {
    const conflict = get(conflicts).find((item) => item.id === id);
    if (conflict) updateCue(conflict.cueId, { start: conflict.remoteStart, end: conflict.remoteEnd });
  }
}

export const activeCues = derived([cues, activeTrackId, selectedCueId], ([$cues, $activeTrackId, $selectedCueId]) =>
  $cues
    .filter((cue) => cue.trackId === $activeTrackId)
    .sort((a, b) => a.start - b.start)
    .map((cue) => ({ ...cue, selected: cue.id === $selectedCueId }))
);

export const pendingActiveVersions = derived(cues, ($cues) =>
  $cues.filter((cue) => cue.versions.filter((v) => !v.archived).length >= 2).length
);
