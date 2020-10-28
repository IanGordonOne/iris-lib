import register from 'preact-custom-element';
import { Component } from 'preact';
import { html } from 'htm/preact';
import { InlineBlock } from 'jsxstyle/preact';
import util from '../util';

const DEFAULT_WIDTH = 80;

class Identicon extends Component {
  constructor() {
    super();
    this.eventListeners = {};
  }

  componentDidUpdate(prevProps) {
    if (prevProps.pub !== this.props.pub) {
      this.componentDidMount();
    }
  }

  componentDidMount() {
    console.log(this.props);
    new iris.Attribute({type: 'keyID', value: this.props.pub}).identiconSrc({width: this.props.width, showType: false}).then(identicon => {
      this.setState({identicon});
    });
    util.getPublicState().user(this.props.pub).get('profile').get('photo').on(photo => {
      if (photo.indexOf('data:image') === 0) {
        this.setState({photo});
      }
    });
    if (this.props.showTooltip) {
      util.getPublicState().user(this.props.pub).get('profile').get('name').on((name,a,b,e) => {
        this.eventListeners['name'] = e;
        this.setState({name})
      });
    }
  }

  componentWillUnmount() {
    Object.values(this.eventListeners).forEach(e => e.off());
    this.eventListeners = {};
  }

  render() {
    return html`
    <${InlineBlock}
      onClick=${this.props.onClick}
      cursor=${this.props.onClick ? 'pointer' : ''}
      borderRadius=${this.props.width || DEFAULT_WIDTH}
      overflow="hidden"
      class="identicon-container ${this.props.showTooltip ? 'tooltip' : ''}">
      ${this.props.showTooltip && this.state.name ? html`<span class="tooltiptext">${this.state.name}</span>` : ''}
      <img width=${this.props.width || DEFAULT_WIDTH} height=${this.props.width || DEFAULT_WIDTH} src="${this.state.photo || this.state.identicon}" alt="${this.state.name || ''}"/>
    <//>`;
  }
}
register(Identicon, 'iris-identicon', ['pub', 'onClick', 'width', 'showTooltip']);

export default Identicon;
