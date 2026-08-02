<script setup>
import { computed, ref } from 'vue';
import { contrastRatio } from '../../demos/wcag';

const props = defineProps({
    foreground: { type: String },
    background: { type: String },
});

const fg = ref(props.foreground);
const bg = ref(props.background);

const levels = [['AA', 4.5], ['AAA', 7], ['AA Large', 3]];
const ratio = computed(() => contrastRatio(fg.value, bg.value));
const badgeClass = (ok) => (ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700');
</script>

<template>
    <div class="flex flex-col gap-4">
        <p class="m-0 text-slate-500">
            <span class="text-lg">💚</span> Rendered by <strong>UX Vue</strong> — a WCAG contrast checker, computed live in the browser (initial colors from Symfony props).
        </p>
        <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 text-sm font-medium">Text
                <input type="color" v-model="fg" class="h-9 w-12 cursor-pointer rounded border border-slate-200">
                <code>{{ fg }}</code>
            </label>
            <label class="flex items-center gap-2 text-sm font-medium">Background
                <input type="color" v-model="bg" class="h-9 w-12 cursor-pointer rounded border border-slate-200">
                <code>{{ bg }}</code>
            </label>
        </div>
        <div class="flex items-center justify-center rounded-lg p-6 text-lg font-semibold" :style="{ color: fg, backgroundColor: bg }">
            The quick brown fox jumps over the lazy dog.
        </div>
        <div class="flex flex-wrap items-center gap-3">
            <strong class="text-2xl">{{ ratio.toFixed(2) }}:1</strong>
            <span v-for="([label, min]) in levels" :key="label" class="rounded-full px-2.5 py-1 text-xs font-bold" :class="badgeClass(ratio >= min)">{{ label }} {{ ratio >= min ? '✓' : '✗' }}</span>
        </div>
    </div>
</template>
