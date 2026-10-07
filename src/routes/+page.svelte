<script lang="ts">
  import { onMount } from "svelte";
  import { derived, get } from "svelte/store";
  import { createQuery } from "@tanstack/svelte-query";
  import { superForm } from "sveltekit-superforms";
  import { zod4 } from "sveltekit-superforms/adapters";
  import { z } from "zod";
  import * as m from "$lib/paraglide/messages.js";
  import { setLocale } from "$lib/paraglide/runtime.js";
  import {
    ACTORS, activeCues, activeTrackId, actor, approvalArchives, conflicts, createSnapshot, cues,
    editTranslation, lastSyncTime, lockTerm, lockedTermViolations, mergeNext, nudgeCue, online,
    pendingActiveVersions, pendingOps, reportIssue, reports, resolveConflict, resolveVersion,
    restoreSnapshot, reviewCue, reviewEvents, reviewer, reviseTerm, selectedCueId, setCueStatus,
    setOnline, simulateRemoteEdit, splitCue, syncNow, syncing, snapshots, terms, tracks, updateCue
  } from "$lib/stores/subtitles";
  import type { Cue, IssueCategory } from "$lib/stores/subtitles";

  const cueSchema = z.object({ source: z.string().min(2), translated: z.string().min(2), start: z.coerce.number().min(0), duration: z.coerce.number().min(0.5).max(30) });
  const defaults = { source: "", translated: "", start: 0, duration: 2.5 };
  const { form, errors, enhance } = superForm(defaults, {
    validators: zod4(cueSchema),
    onSubmit: async ({ formData }) => {
      const start = Number(formData.get("start") ?? 0);
      const text = String(formData.get("translated") ?? "");
      const who = get(actor);
      const item: Cue = {
        id: crypto.randomUUID(), trackId: $activeTrackId, start,
        end: start + Number(formData.get("duration") ?? 2.5),
        source: String(formData.get("source") ?? ""), translated: text,
        status: "翻译中", translator: who, reviewerNote: "",
        versions: [{ id: crypto.randomUUID(), author: who, text, time: new Date().toISOString(), origin: "本地" }],
        baseText: text
      };
      cues.update((items) => [...items, item]);
      selectedCueId.set(item.id);
    }
  });
  const queryOptions = derived(activeTrackId, ($trackId) => ({ queryKey: ["cues", $trackId] as const, queryFn: async (): Promise<Cue[]> => get(activeCues) }));
  const query = createQuery(queryOptions);
  const activeTrack = $derived($tracks.find((track) => track.id === $activeTrackId));
  const selected = $derived($cues.find((cue) => cue.id === $selectedCueId));
  const liveViolations = $derived(selected ? lockedTermViolations(selected.translated) : []);
  const openVersions = $derived(selected ? selected.versions.filter((v) => !v.archived) : []);
  const cueReports = $derived(selected ? $reports.filter((r) => r.cueId === selected.id) : []);

  let reviewNote = $state("");
  let newTermTarget = $state("");
  let reportCategory = $state<IssueCategory>("术语");
  let reportDetail = $state("");
  let flash = $state<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function notify(kind: "ok" | "warn" | "error", text: string) {
    flash = { kind, text };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = null), 3600);
  }

  function formatTime(value: number) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    const tenths = Math.floor((value % 1) * 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function submitForReview() {
    if (!selected) return;
    const result = setCueStatus(selected.id, "待审");
    notify(result.ok ? "ok" : "error", result.ok ? "已提交审校。" : result.reason ?? "提交失败。");
  }

  function doSplit() {
    if (!selected) return;
    splitCue(selected.id);
    notify("ok", $online ? "字幕已拆分。" : "已在本机拆分，操作排队，联网后并入共享时间轴。");
  }

  function doMerge() {
    if (!selected) return;
    const result = mergeNext(selected.id);
    if (result.ok) notify("ok", "已合并下一条字幕。");
    else notify("warn", result.reason ?? "无法合并。");
  }

  function submitReport() {
    if (!selected || !reportDetail.trim()) return;
    const { deduped } = reportIssue(selected.id, reportCategory, reportDetail);
    notify(deduped ? "warn" : "ok", deduped ? "同一处已有人上报，只计一次（已记录重复人）。" : "问题已上报。");
    reportDetail = "";
  }

  function doReviseTerm() {
    if (selectedTermId === "") return;
    const result = reviseTerm(selectedTermId, newTermTarget, "审校组会议确认");
    notify(result.ok ? "ok" : "error", result.ok ? "术语已改版：旧译名与旧审校结论均已留档，受影响字幕需重新确认。" : result.reason ?? "改版失败。");
    if (result.ok) newTermTarget = "";
  }
  let selectedTermId = $state($terms[0]?.id ?? "");

  function mockDivergence() {
    if (!selected) return;
    simulateRemoteEdit(selected.id, `${selected.translated} [周野改稿]`, "周野");
    notify("ok", "已模拟周野在另一台机器改了同一条（服务端）。断网改稿后再同步即可看到分叉。");
  }

  onMount(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "TEXTAREA" || (event.target as HTMLElement)?.tagName === "INPUT") return;
      const list = $activeCues;
      const index = list.findIndex((cue) => cue.id === $selectedCueId);
      if (event.key.toLowerCase() === "j" || event.key === "ArrowDown") selectedCueId.set(list[Math.min(list.length - 1, index + 1)]?.id ?? $selectedCueId);
      if (event.key.toLowerCase() === "k" || event.key === "ArrowUp") selectedCueId.set(list[Math.max(0, index - 1)]?.id ?? $selectedCueId);
      if (event.key.toLowerCase() === "s") doSplit();
      if (event.key.toLowerCase() === "m") doMerge();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); createSnapshot(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
</script>

<svelte:head><title>多语言字幕时间轴协作</title></svelte:head>
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><b>SUBFLOW</b><span>字幕协作台</span></div>
    <nav><button class="active">时间轴编辑</button><button>审校队列</button><button>术语库</button><button>版本快照</button></nav>
    <div class="keyboard"><b>键盘操作</b><span>J / K 选择字幕</span><span>S 拆分 · M 合并</span><span>⌘S 保存快照</span></div>
  </aside>
  <main>
    <header>
      <div><small>纪录片《潮汐线》 · 第 3 集</small><h1>{m.title()}</h1><p>离线改稿与拆分，联网后并入同一条时间轴；锁术语、分叉版本、上报去重与审校留档。</p></div>
      <div class="header-actions">
        <select value={$activeTrackId} onchange={(event) => activeTrackId.set(event.currentTarget.value)}>{#each $tracks as track}<option value={track.id}>{track.name}</option>{/each}</select>
        <select value={$actor} onchange={(event) => actor.set(event.currentTarget.value)} aria-label="当前身份">
          {#each ACTORS as name}<option value={name}>{name}</option>{/each}
        </select>
        <button class:active={$online} class:offline={!$online} class="net" onclick={() => setOnline(!$online)}>
          <span class="dot"></span>{$online ? "在线" : "断网"}
        </button>
        <button class="btn variant-filled-primary" disabled={$syncing || $online === false} onclick={() => syncNow()}>
          {$syncing ? "同步中…" : "立即同步"}
        </button>
        <button onclick={() => setLocale("en")}>EN</button><button onclick={() => setLocale("zh")}>中文</button>
      </div>
    </header>

    {#if flash}<div class={`flash ${flash.kind}`}>{flash.text}</div>{/if}

    <section class="metrics">
      <article><span>当前轨道</span><b>{activeTrack?.name}</b></article>
      <article><span>字幕条数</span><b>{$activeCues.length}</b></article>
      <article><span>分叉待定夺</span><b>{$pendingActiveVersions}</b></article>
      <article><span>待同步操作</span><b class={$pendingOps.length ? "warn-num" : ""}>{$pendingOps.length}</b></article>
      <article><span>已锁定术语</span><b>{$terms.filter((term) => term.status === "已锁定").length}</b></article>
    </section>

    <div class="editor-grid">
      <section class="panel timeline">
        <div class="panel-head">
          <div><h2>时间轴</h2><small>{$online ? "改动实时并入共享时间轴" : "断网中：改译文/拆分先存在本机，恢复后同步"}</small></div>
          <button class="btn variant-filled-primary" onclick={() => createSnapshot()}>保存快照</button>
        </div>
        {#if $query.isPending}<p>正在加载字幕轨道…</p>{:else}
          <div class="cue-list">
            {#each $activeCues as cue}
              <div role="button" tabindex="0" class:selected={cue.id === $selectedCueId} class={`cue ${cue.status}`} onclick={() => selectedCueId.set(cue.id)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") selectedCueId.set(cue.id); }}>
                <time>{formatTime(cue.start)}<small>{formatTime(cue.end)}</small></time>
                <div>
                  <b>{cue.source}</b>
                  <p>{cue.translated || "尚未填写译文"}</p>
                  <div class="cue-badges">
                    {#if cue.needsConfirm}<span class="badge reconfirm">术语改版 · 需重新确认</span>{/if}
                    {#if cue.versions.filter((v) => !v.archived).length >= 2}<span class="badge conflict">双版本待定夺</span>{/if}
                    {#if cue.splitParentId}<span class="badge split">离线拆分</span>{/if}
                    {#if $pendingOps.some((op) => op.cueId === cue.id)}<span class="badge queued">待同步</span>{/if}
                  </div>
                </div>
                <span class={`chip ${cue.status}`}>{cue.status}</span>
                <button class="btn btn-sm" onclick={(event) => { event.stopPropagation(); nudgeCue(cue.id, -0.2); }}>−0.2s</button>
                <button class="btn btn-sm" onclick={(event) => { event.stopPropagation(); nudgeCue(cue.id, 0.2); }}>+0.2s</button>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <aside class="right-stack">
        <section class="panel">
          <div class="panel-head"><h2>字幕编辑</h2>{#if selected}<span class={`chip ${selected.status}`}>{selected.status}</span>{/if}</div>
          {#if selected}
            <label class="label"><span>原文字幕</span><input class="input" value={selected.source} oninput={(event) => updateCue(selected.id, { source: event.currentTarget.value })} /></label>
            <label class="label">
              <span>译文{#if !$online}<em class="hint">（断网改稿，本机即时生效并排队）</em>{/if}</span>
              <textarea class="textarea" value={selected.translated} oninput={(event) => editTranslation(selected.id, event.currentTarget.value)}></textarea>
            </label>
            {#if liveViolations.length}
              <div class="flash error inline">锁定术语不许被普通译文盖掉，缺少：
                {#each liveViolations as term, i}{#if i > 0}、{/if}<b>{term.source} → {term.target}</b>{/each}
              </div>
            {/if}
            {#if selected.needsConfirm}<div class="flash warn inline">术语已改版，此条原审校结论失效，确认后需重新审校。</div>{/if}
            <div class="time-fields"><label class="label"><span>开始秒</span><input class="input" type="number" step="0.1" value={selected.start} oninput={(event) => updateCue(selected.id, { start: Number(event.currentTarget.value) })} /></label><label class="label"><span>结束秒</span><input class="input" type="number" step="0.1" value={selected.end} oninput={(event) => updateCue(selected.id, { end: Number(event.currentTarget.value) })} /></label></div>
            <div class="actions">
              <button class="btn" onclick={doSplit}>拆分 (S)</button>
              <button class="btn" onclick={doMerge} disabled={!$online}>合并下一条 (M)</button>
              <button class="btn" onclick={submitForReview}>提交审校</button>
              <button class="btn variant-filled-success" onclick={() => reviewCue(selected.id, true)}>审校通过</button>
              <button class="btn variant-filled-error" onclick={() => reviewCue(selected.id, false, reviewNote || "请核对术语和断句")}>退回修改</button>
            </div>
            <label class="label"><span>审校备注</span><input class="input" bind:value={reviewNote} placeholder="退回时填写具体原因" /></label>

            {#if openVersions.length >= 2}
              <div class="versions">
                <h3>两人改过同一条 · 各留一版，等审校定夺</h3>
                {#each openVersions as v}
                  <article>
                    <div><b>{v.author}</b><span class="origin">{v.origin}</span><small>{new Date(v.time).toLocaleTimeString("zh-CN")}</small></div>
                    <p>{v.text}</p>
                    <button class="btn btn-sm variant-filled-primary" onclick={() => { resolveVersion(selected.id, v.id); notify("ok", `已采用 ${v.author} 的版本，另一版留档。`); }}>采用此版</button>
                  </article>
                {/each}
              </div>
            {/if}

            <div class="report-box">
              <h3>问题上报<small>同一处重复上报只算一次</small></h3>
              <div class="actions">
                <select bind:value={reportCategory} class="input">
                  <option value="术语">术语</option><option value="超长">超长</option><option value="错译">错译</option><option value="时间码">时间码</option><option value="其他">其他</option>
                </select>
                <input class="input" placeholder="问题描述（同人同条同描述视为重复）" bind:value={reportDetail} />
                <button class="btn variant-filled-primary" onclick={submitReport}>上报</button>
              </div>
              {#each cueReports as r}
                <div class="report-row"><b>{r.category}</b> {r.detail}<small>{r.reporter}{#if r.duplicates.length} · 另有 {r.duplicates.length} 次重复上报（只计一次）{/if}</small></div>
              {/each}
              <button class="btn btn-sm" onclick={mockDivergence}>模拟协作者改此条（制造分叉）</button>
            </div>
          {:else}<p>请先选择一条字幕。</p>{/if}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>术语锁定</h2><small>锁定译名必须保留；只有术语管理员可改版</small></div>
          {#each $terms as term}
            <div class="term">
              <span><b>{term.source}</b> → {term.target} {#if term.status === "已锁定"}<em class="lock-tag">已锁定</em>{/if}
                {#if term.history.length}<small>旧译名：{term.history.map((h) => h.target).join(" / ")}</small>{/if}
              </span>
              <button class="btn btn-sm" disabled={term.status === "已锁定"} onclick={() => lockTerm(term.id)}>{term.status}</button>
            </div>
            {#if term.status === "已锁定"}
              <div class="revise">
                <input class="input" placeholder="新锁定译名" value={selectedTermId === term.id ? newTermTarget : ""} onfocus={() => (selectedTermId = term.id)} oninput={(event) => { selectedTermId = term.id; newTermTarget = event.currentTarget.value; }} />
                <button class="btn btn-sm variant-filled-error" disabled={$actor !== "术语管理员"} onclick={() => { selectedTermId = term.id; doReviseTerm(); }}>改版并作废旧审校</button>
              </div>
            {/if}
          {/each}
          {#if $actor !== "术语管理员"}<p class="muted">切换到「术语管理员」身份可修改锁定术语。</p>{/if}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>同步队列</h2><small>{$lastSyncTime ? `上次同步 ${new Date($lastSyncTime).toLocaleTimeString("zh-CN")}` : "尚未同步"}</small></div>
          {#if !$pendingOps.length}<p class="muted">队列是空的，本机改动都已并入共享时间轴。</p>{/if}
          {#each $pendingOps as op}
            <article class={`queue-op ${op.blockedReason ? "blocked" : ""}`}>
              <b>{op.type === "edit" ? "译文修改" : "字幕拆分"}</b> · {op.author}
              <small>{new Date(op.time).toLocaleTimeString("zh-CN")}</small>
              {#if op.blockedReason}<p class="block-reason">⛔ {op.blockedReason}</p>{/if}
            </article>
          {/each}
        </section>
      </aside>
    </div>

    <div class="bottom-grid">
      <section class="panel">
        <div class="panel-head"><h2>新增字幕</h2></div>
        <form class="cue-form" method="POST" use:enhance>
          <label class="label"><span>原文</span><input class="input" name="source" bind:value={$form.source} /><small>{$errors.source?.[0]}</small></label>
          <label class="label"><span>译文</span><input class="input" name="translated" bind:value={$form.translated} /><small>{$errors.translated?.[0]}</small></label>
          <label class="label"><span>开始秒</span><input class="input" name="start" type="number" step="0.1" bind:value={$form.start} /></label>
          <label class="label"><span>持续秒</span><input class="input" name="duration" type="number" step="0.1" bind:value={$form.duration} /></label>
          <button class="btn variant-filled-primary" type="submit">新增到当前轨道</button>
        </form>

        <div class="panel-head" style="margin-top:16px"><h2>协作冲突（时间码）</h2></div>
        {#each $conflicts as conflict}
          <article class="conflict"><b>{conflict.message}</b><p>协作版本：{formatTime(conflict.remoteStart)}–{formatTime(conflict.remoteEnd)}</p><div class="actions"><button class="btn btn-sm" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用本地")}>保留本机</button><button class="btn btn-sm variant-filled-primary" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用协作版本")}>采用协作版本</button><span class="chip">{conflict.status}</span></div></article>
        {/each}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>问题上报台账</h2><small>同一处重复上报只算一次</small></div>
        <div class="events">
          {#each $reports as item}
            <article>
              <b>[{item.category}] {item.detail}</b>
              <p>字幕 {item.cueId} · 首报 {item.reporter} · {new Date(item.time).toLocaleString("zh-CN")}</p>
              {#if item.duplicates.length}<small class="dedup">重复上报 {item.duplicates.length} 次（{item.duplicates.map((d) => d.reporter).join("、")}），仅计 1 条</small>{/if}
            </article>
          {/each}
          {#if !$reports.length}<p>暂无上报。</p>{/if}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>审校留档</h2><small>术语改版后失效的通过结论与旧译文</small></div>
        <div class="events">
          {#each $approvalArchives as item}
            <article class="archived">
              <b>已失效 · 字幕 {item.cueId}</b>
              <p>{item.reason}</p>
              <small>原通过译文：{item.approvedText}</small><br />
              <small>失效时间：{new Date(item.invalidatedAt).toLocaleString("zh-CN")}</small>
            </article>
          {/each}
          {#if !$approvalArchives.length}<p>暂无失效记录。</p>{/if}
        </div>
      </section>
    </div>

    <div class="bottom-grid" style="grid-template-columns: 1fr 1fr;">
      <section class="panel"><div class="panel-head"><h2>操作流水</h2></div><div class="events">{#each $reviewEvents as item}<article><b>{item.action}</b><p>{item.detail}</p><small>{item.actor} · {new Date(item.time).toLocaleTimeString("zh-CN")}</small></article>{/each}{#if !$reviewEvents.length}<p>暂无操作。</p>{/if}</div></section>
      <section class="panel"><div class="panel-head"><h2>版本快照</h2></div><div class="events">{#each $snapshots as item}<article><b>{item.name}</b><p>{item.cues.length} 条字幕 · {new Date(item.time).toLocaleString("zh-CN")}</p><button class="btn btn-sm" onclick={() => restoreSnapshot(item.id)}>恢复</button></article>{/each}{#if !$snapshots.length}<p>使用 ⌘S 或顶部按钮创建快照。</p>{/if}</div></section>
    </div>
  </main>
</div>
