<script setup>
import {ref} from "vue";

const step = 1;
const count = ref(0);
</script>

<template>
    Counter: {{ count }}
    <button type="button" @click="count -= step">-</button>
    <button type="button" @click="count += step">+</button>
</template>
