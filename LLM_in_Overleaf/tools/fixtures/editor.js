import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView, drawSelection } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';

window.EditorSelection = EditorSelection;
window.undoEditor = () => undo(window.editor);

window.mountEditor = (parent = document.querySelector('#editor'), doc = '\\section{Introduction}\nDeep learning have revolutionized many field.\nWe study a new method.') => {
  return new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [drawSelection(), EditorView.lineWrapping, EditorState.allowMultipleSelections.of(true), history()] }),
  });
};
window.editor = window.mountEditor();
window.resetEditor = (doc) => {
  window.editor.destroy();
  window.editor = window.mountEditor(document.querySelector('#editor'), doc);
};
