<template>
    <div>
        <div>Hello {{ fullName }} (rendered by UX Vue)!</div>
        <Counter/>
    </div>
</template>

<script setup>
import Counter from "../Counter.vue";

defineProps({
    fullName: String,
});
</script>
