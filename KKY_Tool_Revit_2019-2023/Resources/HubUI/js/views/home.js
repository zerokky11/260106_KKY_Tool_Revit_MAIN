// Resources/HubUI/js/views/home.js
import { clear, div } from '../core/dom.js';

export function renderHome(root) {
    const target = root || document.getElementById('view-root') || document.getElementById('app');
    clear(target);

    const view = div('home-choice');
    const hero = div('home-choice-hero');
    hero.innerHTML = `
        <p class="home-choice-kicker">KKY Tool Hub</p>
        <h2>검토 방식을 선택하세요</h2>
        <p>활성 문서 기반 검토 또는 다중 RVT 배치 검토를 시작할 수 있습니다.</p>`;

    const grid = div('home-choice-grid');
    grid.append(
        buildCard('활성 문서 검토', '현재 열려있는 Revit 문서를 대상으로 빠르게 검토를 수행합니다.', 'dup'),
        buildCard('다중 RVT 검토', '여러 RVT 파일을 등록하고 배치 검토 및 엑셀 추출을 실행합니다.', 'multi')
    );

    view.append(hero, grid);
    target.append(view);

    function buildCard(title, desc, hash) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'home-choice-card';
        card.innerHTML = `
            <h3>${title}</h3>
            <p>${desc}</p>
            <span class="home-choice-cta">바로가기</span>`;
        card.addEventListener('click', () => { location.hash = `#${hash}`; });
        return card;
    }
}
