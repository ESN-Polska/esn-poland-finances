import { Component } from '@angular/core';

@Component({
  selector: 'app-rules-tab',
  templateUrl: './rules.page.html',
  styleUrls: ['./rules.page.scss']
})
export class RulesPage {
  public downloadRules(): void {
    // Open or download the ESN Poland financial regulations document
    window.open('https://media.finances.esn-poland.link/rules/finances-rules.pdf', '_blank');
  }
}
