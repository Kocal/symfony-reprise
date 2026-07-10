import type { Application, ControllerConstructor } from '@hotwired/stimulus';
import type { EagerControllersCollection, LazyControllersCollection } from './types';
import { Application as StimulusApplication } from '@hotwired/stimulus';
import { eagerControllers, isApplicationDebug, lazyControllers } from 'virtual:symfony/controllers';

const CONTROLLER_ATTRIBUTE = 'data-controller';

export function startStimulusApp(): Application {
    const application = StimulusApplication.start();
    application.debug = isApplicationDebug;
    loadControllers(application, eagerControllers, lazyControllers);
    return application;
}

export function loadControllers(
    application: Application,
    eager: EagerControllersCollection,
    lazy: LazyControllersCollection
): void {
    for (const identifier in eager) registerController(identifier, eager[identifier], application);
    new StimulusLazyControllerHandler(application, { ...lazy }).start();
}

class StimulusLazyControllerHandler {
    constructor(
        private application: Application,
        private lazyControllers: LazyControllersCollection
    ) {}

    start(): void {
        this.lazyLoadExistingControllers(document.documentElement);
        this.lazyLoadNewControllers(document.documentElement);
    }

    private lazyLoadExistingControllers(element: Element): void {
        Array.from(element.querySelectorAll(`[${CONTROLLER_ATTRIBUTE}]`))
            .flatMap(extractControllerNamesFrom)
            .forEach((name) => this.loadLazyController(name));
    }

    private loadLazyController(name: string): void {
        const loader = this.lazyControllers[name];
        if (!loader) return;
        delete this.lazyControllers[name];
        if (!canRegisterController(name, this.application)) return;
        loader()
            .then((module) => registerController(name, module.default, this.application))
            .catch((error) => console.error(`Error loading controller "${name}":`, error));
    }

    private lazyLoadNewControllers(element: Element): void {
        if (Object.keys(this.lazyControllers).length === 0) return;
        new MutationObserver((mutations) => {
            for (const { attributeName, target, type } of mutations) {
                if (
                    type === 'attributes' &&
                    attributeName === CONTROLLER_ATTRIBUTE &&
                    (target as Element).getAttribute(CONTROLLER_ATTRIBUTE)
                )
                    extractControllerNamesFrom(target as Element).forEach((name) => this.loadLazyController(name));
                else if (type === 'childList') this.lazyLoadExistingControllers(target as Element);
            }
        }).observe(element, { attributeFilter: [CONTROLLER_ATTRIBUTE], subtree: true, childList: true });
    }
}

function registerController(identifier: string, controller: ControllerConstructor, application: Application): void {
    if (canRegisterController(identifier, application)) application.register(identifier, controller);
}

function extractControllerNamesFrom(element: Element): string[] {
    const value = element.getAttribute(CONTROLLER_ATTRIBUTE);
    return value ? value.split(/\s+/).filter((n) => n.length > 0) : [];
}

function canRegisterController(identifier: string, application: Application): boolean {
    // `router` is internal to Stimulus but stable; it's what @symfony/stimulus-bundle uses.
    return !(
        application as unknown as { router: { modulesByIdentifier: Map<string, unknown> } }
    ).router.modulesByIdentifier.has(identifier);
}
