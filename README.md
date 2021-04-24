# JS Parser for [gettext-extractor](https://github.com/lukasgeiter/gettext-extractor)

Extract comments provided by a string or an object in the translator function.

```ts
import { callExpressionExtractor, ICustomJsExtractorOptions } 
    from '@floratmin/gettext-extractor-js-parser';
import { GettextExtractor } from 'gettext-extractor';

const options: ICustomJsExtractorOptions = {
    arguments: {
        text: 0,
        textPlural: 1,
        comments: 2,
        context: 3,
    },
    comments: {
        commentString: 'comment',
        props: {
            props: ['{', '}']
        }
    }
};

const extractor = new GettextExtractor();

extractor
    .createJsParser()
    .addExtractor(callExpressionExtractor('_', options))
    .parseFilesGlob('src/**/*.@(ts|js|tsx|jsx)');
```

If `options.comments` is not set, than a string is used as comment.

### `callExpressionExtractor(calleeName, options)`

##### Parameters
| Name          | Type   | Details                                                                 |
|---------------|--------|-------------------------------------------------------------------------|
| `calleeName`  | *string* or<br>*string[]* | **Required** · Name(s) of the function(s)            |
| `options`     | *object*                  | Options to configure the extractor function          |
| → `arguments` | *object*                  | **Required** · See [Argument Mapping](#argument-mapping) below          |
| → `comments`  | *object*                  | See [Comment Options](#comment-options) below                          |
| → `content`   | *object*                  | See [Content Options](#content-options) below                          |

###### <a id="argument-mapping"></a>Argument Mapping
| Name        | Type   |                                                                         |
|-------------|--------|-------------------------------------------------------------------------|
| `text`        | *number* | **Required** · Position of the argument containing the message text |
| `textPlural`  | *number* | Position of the argument containing the plural message text         |
| `context`     | *number* | Position of the argument containing the message context             |
| `comments`    | *number* | Position of the argument containing the comments string or object   |

###### <a id="comment-options"></a>Comment Options
If ommitted the comment is expected to be a string. Otherwise, the comment has to be an object.

| Name                 | Type      | Default   | Details                                                               |
|----------------------|-----------|-----------|-----------------------------------------------------------------------|
| `commentString`      | *string*  | `comment` | key for providing plain comments                                      |
| `props`              | *object*  |           | each key under has an value of an array with two strings. These strings are wrapped around each property of an object provided under this key. |
| `throwWhenMalformed` | *boolean* | `true`    | If set to `true`, throws an error when in the comment object any value is not a plain string |
| `fallback`           | *boolean* | `true`    | If set to `true`, an omitted argument fallbacks to the next argument if the next argument is of different type|

###### <a id="content-options"></a>Content Options
| Name                  | Type                    | Default   | Details                                                |
|-----------------------|-------------------------|-----------|--------------------------------------------------------|
| `trimWhiteSpace`      | *boolean*               | `false`   | If set to `true`, white space at the very beginning and at the end of the content will get removed<br>Normally this behaves like `.trim()`, however if `preseveIndentation` is `true`, the indentation of the first line is kept as well.|
| `preserveIndentation` | *boolean*               | `true`    | If set to `false`, white space at the beginning of the line will get removed |
| `replaceNewLines`     | *false* or <br>*string* | `false`   | If a string is provided all new lines will be replaced with it |

##### Return Value
*function* · An extractor function that extracts messages from call expressions.

#### Example
With the example settings from the usage example and the following functions
```ts
const string1 = (worldPlace: string) => _(
    'Hello {PLACE}', 
    'Plural', 
    {
        comment: 'Comment', 
        props: {
            PLACE: 'The place of interest'
        }, 
        path: 'http://www.example.com', 
        nested: {
            key1: 'Key1',
            key2: 'Key2'
        }
    },
    'Context',
    {
        PLACE: worldPlace
    }
);
// when ommiting second argument the third argument can take the place of the second argument 
// if the arguments are of different type. If there are more arguments, they also change their
// place accordingly.
const string2 = _(
    'Foo',
    {
        comment: 'No Plural here.'
    }
);
// omit comment object
const string3 = _(
    'Foo2',
    'Plural',
    'Context'
);
// skip textPlural and comment object, allowed placeholders are `null`, `undefined` or `0`
const string4 = _(
    'Foo3',
    null,
    null,
    'Context'
);
// if argument is not string or comment object than rest of arguments are ignored
const string5 = (props: {PROPS: string}) => _(
    'My {PROPS}',
    {
        props: {
            PROPS: 'Some props'
        }
    },
    props
);
```

We extract the following messages
```js
[
    {
        text: 'Hello {PLACE}',
        textPlural: 'Plural',
        comments: [
            'Comment',
            'path: http://www.example.com',
            '{PLACE}: The place of interest',
            'nested.key1: Key1',
            'nested.key2: Key2'
        ],
        context: 'Context'
    },
    {
        text: 'Foo',
        comments: [
            'No Plural here.'
        ],
    },
    {
        text: 'Foo2',
        textPlural: 'Plural',
        context: 'Context'
    },
    {
        text: 'Foo3',
        context: 'Context'
    },
    {
        text: 'My {PROPS}',
        comments: [
            '{PROPS}: Some props'
        ]
    }
]
```
If any argument is not a string or comment object then the parsing is cut off starting from this argument. If there are
other arguments in between these arguments, their position is not considered in the fallback.