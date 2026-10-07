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
    activeCues, activeTrackId, adoptVersion, archives, conflicts, createSnapshot, cues,
    cueVersions, editTranslation, injectRemoteChange, injectRemoteSplit, lockTerm, mergeNext,
    mergePending, nudgeCue, online, pendingChanges, pendingVersionCount, remoteChanges,
    remoteVariants, removePendingChange, removeRemoteChange, resolveConflict, restoreSnapshot,
    reviewCue, reviewEvents, reviewer, selectedCueId, setCueStatus, setOnline, snapshots,
    splitCue, submitForReview, terms, termError, tracks, updateCue, updateTermTarget
  } from "$lib/stores/subtitles";
  import type { Cue } from "$lib/stores/subtitles";

  const cueSchema = z.object({ source: z.string().min(2), translated: z.string().min(2), start: z.coerce.number().min(0), duration: z.coerce.number().min(0.5).max(30) });
  const defaults = { source: "", translated: "", start: 0, duration: 2.5 };
  const { form, errors, enhance } = superForm(defaults, {
    validators: zod4(cueSchema),
    onSubmit: async ({ formData }) => {
      const start = Number(formData.get("start") ?? 0);
      const item: Cue = { id: crypto.randomUUID(), trackId: $activeTrackId, start, end: start + Number(formData.get("duration") ?? 2.5), source: String(formData.get("source") ?? ""), translated: String(formData.get("translated") ?? ""), status: "翻译中", translator: "当前译者", reviewerNote: "" };
      cues.update((items) => [...items, item]);
      selectedCueId.set(item.id);
    }
  });
  const queryOptions = derived(activeTrackId, ($trackId) => ({ queryKey: ["cues", $trackId] as const, queryFn: async (): Promise<Cue[]> => get(activeCues) }));
  const query = createQuery(queryOptions);
  const activeTrack = $derived($tracks.find((track) => track.id === $activeTrackId));
  const selected = $derived($cues.find((cue) => cue.id === $selectedCueId));
  const selectedPending = $derived($pendingChanges.find((change) => change.cueId === $selectedCueId));
  const selectedVersions = $derived($cueVersions.filter((version) => version.cueId === $selectedCueId && version.status === "待定夺"));
  const pendingForTrack = $derived($pendingChanges.filter((change) => $cues.some((cue) => cue.id === change.cueId && cue.trackId === $activeTrackId)));
  const remoteForTrack = $derived($remoteChanges.filter((change) => $cues.some((cue) => cue.id === change.cueId && cue.trackId === $activeTrackId)));
  let reviewNote = $state("");

  function formatTime(value: number) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    const tenths = Math.floor((value % 1) * 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function changeLabel(type: string) {
    return type === "译文" ? "改译文" : type === "时间码" ? "调时间码" : "拆分";
  }

  onMount(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "TEXTAREA" || (event.target as HTMLElement)?.tagName === "INPUT") return;
      const list = $activeCues;
      const index = list.findIndex((cue) => cue.id === $selectedCueId);
      if (event.key.toLowerCase() === "j" || event.key === "ArrowDown") selectedCueId.set(list[Math.min(list.length - 1, index + 1)]?.id ?? $selectedCueId);
      if (event.key.toLowerCase() === "k" || event.key === "ArrowUp") selectedCueId.set(list[Math.max(0, index - 1)]?.id ?? $selectedCueId);
      if (event.key.toLowerCase() === "s") splitCue($selectedCueId);
      if (event.key.toLowerCase() === "m") mergeNext($selectedCueId);
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
      <div><small>纪录片《潮汐线》 · 第 3 集</small><h1>{m.title()}</h1><p>断网时改译文、拆字幕条，联网后合并到同一时间轴；锁定术语不可覆盖，两人改同一版则各留一版等审校定夺。</p></div>
      <div class="header-actions">
        <span class={`net-chip ${$online ? "online" : "offline"}`}>{$online ? "● 在线" : "○ 断网"}</span>
        <button class="btn" onclick={() => setOnline(!$online)}>{$online ? "模拟断网" : "恢复网络"}</button>
        <select value={$activeTrackId} onchange={(event) => activeTrackId.set(event.currentTarget.value)}>{#each $tracks as track}<option value={track.id}>{track.name}</option>{/each}</select>
        <button onclick={() => setLocale("en")}>EN</button><button onclick={() => setLocale("zh")}>中文</button>
      </div>
    </header>

    {#if !$online}
      <div class="offline-banner">
        <b>断网中：</b>译文、时间码与拆分操作会积压在本机，共 <b>{$pendingChanges.length}</b> 处改动；网络恢复后自动合并到时间轴。
      </div>
    {:else if $pendingChanges.length || $remoteChanges.length}
      <div class="offline-banner merge">
        <b>网络已恢复：</b>本机 {$pendingChanges.length} 处待合并、协作者 {$remoteChanges.length} 处待合并。
        <button class="btn btn-sm variant-filled-primary" onclick={() => mergePending()}>立即合并到时间轴</button>
      </div>
    {/if}

    <section class="metrics">
      <article><span>当前轨道</span><b>{activeTrack?.name}</b></article>
      <article><span>字幕条数</span><b>{$activeCues.length}</b></article>
      <article><span>待审</span><b>{$activeCues.filter((cue) => cue.status === "待审").length}</b></article>
      <article><span>已锁定术语</span><b>{$terms.filter((term) => term.status === "已锁定").length}</b></article>
      <article><span>离线积压</span><b>{$pendingChanges.length + $remoteChanges.length}</b></article>
      <article><span>版本待定夺</span><b>{$pendingVersionCount}</b></article>
    </section>

    <div class="editor-grid">
      <section class="panel timeline">
        <div class="panel-head"><div><h2>时间轴</h2><small>断网改动先存本机，联网自动合并；所有修改保存到浏览器本地</small></div><button class="btn variant-filled-primary" onclick={() => createSnapshot()}>保存快照</button></div>
        {#if $query.isPending}<p>正在加载字幕轨道…</p>{:else}
          <div class="cue-list">
            {#each $activeCues as cue}
              <div role="button" tabindex="0" class:selected={cue.id === $selectedCueId} class={`cue ${cue.status}`} onclick={() => selectedCueId.set(cue.id)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") selectedCueId.set(cue.id); }}>
                <time>{formatTime(cue.start)}<small>{formatTime(cue.end)}</small></time>
                <div>
                  <b>{cue.source}</b>
                  <p>{cue.translated || "尚未填写译文"}</p>
                  <div class="badges">
                    {#if cue.pending}<span class="chip pending">离线已改</span>{/if}
                    {#if cue.versionCount}<span class="chip versions">{cue.versionCount} 版待定夺</span>{/if}
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
            {#if selectedPending}<p class="pending-note">离线改动待联网合并（{changeLabel(selectedPending.type)} · {new Date(selectedPending.time).toLocaleTimeString("zh-CN")}）</p>{/if}
            {#if selectedVersions.length}<p class="pending-note versions">该字幕有 {selectedVersions.length} 版译文等待审校定夺</p>{/if}
            <label class="label"><span>原文字幕</span><input class="input" value={selected.source} oninput={(event) => updateCue(selected.id, { source: event.currentTarget.value })} /></label>
            <label class="label">
              <span>译文{#if !$online}（断网可改，联网后合并）{/if}</span>
              <textarea class="textarea" class:invalid={$termError} value={selected.translated} oninput={(event) => { if (!editTranslation(selected.id, event.currentTarget.value)) event.currentTarget.value = selected.translated; }}></textarea>
              {#if $termError}<small class="term-error">{$termError}</small>{/if}
            </label>
            <div class="time-fields">
              <label class="label"><span>开始秒</span><input class="input" type="number" step="0.1" value={selected.start} oninput={(event) => updateCue(selected.id, { start: Number(event.currentTarget.value) })} /></label>
              <label class="label"><span>结束秒</span><input class="input" type="number" step="0.1" value={selected.end} oninput={(event) => updateCue(selected.id, { end: Number(event.currentTarget.value) })} /></label>
            </div>
            <div class="actions">
              <button class="btn" onclick={() => submitForReview(selected.id)}>提交审校</button>
              <button class="btn variant-filled-success" onclick={() => reviewCue(selected.id, true)}>审校通过</button>
              <button class="btn variant-filled-error" onclick={() => reviewCue(selected.id, false, reviewNote || "请核对术语和断句")}>退回修改</button>
            </div>
            <label class="label"><span>审校备注</span><input class="input" bind:value={reviewNote} placeholder="退回时填写具体原因" /></label>
          {:else}<p>请先选择一条字幕。</p>{/if}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>离线改动与合并</h2><small>断网积压 · 联网自动合并</small></div>
          <div class="actions">
            <button class="btn btn-sm" disabled={!selected} onclick={() => selected && injectRemoteChange(selected.id, remoteVariants[selected.id] ?? `${selected.translated}（协作修订）`)}>模拟协作者改译文</button>
            <button class="btn btn-sm" disabled={!selected} onclick={() => selected && injectRemoteSplit(selected.id)}>模拟协作者拆分</button>
            <button class="btn btn-sm variant-filled-primary" disabled={!$pendingChanges.length && !$remoteChanges.length} onclick={() => mergePending()}>立即合并（{$pendingChanges.length + $remoteChanges.length}）</button>
          </div>
          {#if pendingForTrack.length}
            <div class="change-group"><b>本机离线改动</b>
              {#each pendingForTrack as change}
                <article class="change-item"><span class="chip pending">{changeLabel(change.type)}</span><p>{$cues.find((cue) => cue.id === change.cueId)?.source ?? change.cueId}</p><small>{change.actor} · {new Date(change.time).toLocaleTimeString("zh-CN")}</small><button class="btn btn-sm" onclick={() => removePendingChange(change.id)}>撤销</button></article>
              {/each}
            </div>
          {/if}
          {#if remoteForTrack.length}
            <div class="change-group"><b>协作者改动</b>
              {#each remoteForTrack as change}
                <article class="change-item remote"><span class="chip remote">{changeLabel(change.type)}</span><p>{change.payload.translated ?? "拆分字幕条"}</p><small>{change.actor} · {new Date(change.time).toLocaleTimeString("zh-CN")}</small><button class="btn btn-sm" onclick={() => removeRemoteChange(change.id)}>忽略</button></article>
              {/each}
            </div>
          {/if}
          {#if !pendingForTrack.length && !remoteForTrack.length}<p class="empty-note">暂无积压改动。断网后编辑译文或按 S 拆分，改动会积压到这里。</p>{/if}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>版本定夺</h2><small>两人各改一版，审校采用一版</small></div>
          {#each $cueVersions.filter((version) => version.status === "待定夺") as version}
            <article class="version-item">
              <div class="version-head"><span class={`chip ${version.origin === "本地" ? "pending" : "remote"}`}>{version.origin} · {version.actor}</span><small>{new Date(version.time).toLocaleString("zh-CN")}</small></div>
              <p>{version.translated}</p>
              <button class="btn btn-sm variant-filled-primary" onclick={() => adoptVersion(version.id)}>采用此版</button>
            </article>
          {/each}
          {#if !$cueVersions.some((version) => version.status === "待定夺")}<p class="empty-note">暂无多版冲突。断网后你和协作者改了同一条字幕，合并时会在这里各留一版。</p>{/if}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>术语锁定</h2><small>锁定术语不可被普通译文覆盖；改译文后已通过结论失效</small></div>
          {#each $terms as term}
            <div class="term">
              <span><b>{term.source}</b> → <input class="input term-target" value={term.target} onchange={(event) => updateTermTarget(term.id, event.currentTarget.value)} /></span>
              <button class="btn btn-sm" disabled={term.status === "已锁定"} onclick={() => lockTerm(term.id)}>{term.status === "已锁定" ? "已锁定" : "锁定"}</button>
            </div>
          {/each}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>协作冲突</h2></div>
          {#each $conflicts as conflict}
            <article class="conflict"><b>{conflict.message}</b><p>协作版本：{formatTime(conflict.remoteStart)}–{formatTime(conflict.remoteEnd)}</p><div class="actions"><button class="btn btn-sm" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用本地")}>保留本机</button><button class="btn btn-sm variant-filled-primary" disabled={conflict.status !== "待处理"} onclick={() => resolveConflict(conflict.id, "采用协作版本")}>采用协作版本</button><span class="chip">{conflict.status}</span></div></article>
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
      </section>
      <section class="panel">
        <div class="panel-head"><h2>留档记录</h2><small>术语变更后失效的原译文与审校记录</small></div>
        <div class="events">
          {#each $archives as archive}
            <article class="archive-item">
              <b>{archive.reason}</b>
              <p>原译文：{archive.translated || "（空）"}</p>
              <small>字幕 {archive.cueId} · 原状态 {archive.status} · {new Date(archive.time).toLocaleString("zh-CN")}</small>
              {#if archive.events.length}<details><summary>{archive.events.length} 条原审校记录</summary>{#each archive.events as record}<p>{record.action} · {record.actor} · {new Date(record.time).toLocaleString("zh-CN")}</p>{/each}</details>{/if}
            </article>
          {/each}
          {#if !$archives.length}<p>暂无留档。术语译文变更或锁定后，失效字幕的原译文与审校记录会保存到这里。</p>{/if}
        </div>
      </section>
      <section class="panel"><div class="panel-head"><h2>审校记录</h2></div><div class="events">{#each $reviewEvents as item}<article><b>{item.action}</b><p>{item.detail}</p><small>{item.actor} · {new Date(item.time).toLocaleTimeString("zh-CN")}</small></article>{/each}{#if !$reviewEvents.length}<p>暂无审校操作。</p>{/if}</div></section>
      <section class="panel"><div class="panel-head"><h2>版本快照</h2></div><div class="events">{#each $snapshots as item}<article><b>{item.name}</b><p>{item.cues.length} 条字幕 · {new Date(item.time).toLocaleString("zh-CN")}</p><button class="btn btn-sm" onclick={() => restoreSnapshot(item.id)}>恢复</button></article>{/each}{#if !$snapshots.length}<p>使用 ⌘S 或顶部按钮创建快照。</p>{/if}</div></section>
    </div>
  </main>
</div>
