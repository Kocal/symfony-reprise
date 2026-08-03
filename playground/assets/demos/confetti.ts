const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7']

export function celebrate(): void {
    for (let i = 0; i < 90; i++) {
        const piece = document.createElement('div')
        piece.dataset.confettiPiece = ''
        piece.style.cssText = `position:fixed;top:-12px;left:${(i * 53) % 100}vw;width:9px;height:9px;`
            + `background:${COLORS[i % COLORS.length]};z-index:9999;pointer-events:none;border-radius:2px`
        document.body.appendChild(piece)
        piece
            .animate(
                [
                    { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
                    { transform: `translateY(100vh) rotate(${540 + i * 7}deg)`, opacity: 0.15 },
                ],
                { duration: 1600 + (i % 12) * 120, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
            )
            .addEventListener('finish', () => piece.remove())
    }
}
