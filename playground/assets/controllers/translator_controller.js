import { Controller } from '@hotwired/stimulus'
import { trans } from '../translator.js'

export default class extends Controller {
    static targets = ['greeting', 'apples']

    locale = 'en'
    count = 3

    connect() {
        this.render()
    }

    english() {
        this.locale = 'en'
        this.render()
    }

    french() {
        this.locale = 'fr'
        this.render()
    }

    more() {
        this.count += 1
        this.render()
    }

    fewer() {
        this.count = Math.max(0, this.count - 1)
        this.render()
    }

    render() {
        this.greetingTarget.textContent = trans('greeting', { '%name%': 'Reprise' }, 'messages', this.locale)
        this.applesTarget.textContent = trans('apples', { count: this.count }, 'messages', this.locale)
    }
}
