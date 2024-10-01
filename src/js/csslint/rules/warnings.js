import {registerRuleEvents} from './util';

export default [{
  desc: 'Parser warnings.',
}, (rule, parser, reporter) => {
  parser.addListener('warning', e => reporter.report(e.message, e, rule));
}];
