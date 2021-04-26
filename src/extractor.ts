import * as ts from 'typescript';

import { IAddMessageCallback, IMessageData } from 'gettext-extractor/dist/parser';
import { IJsExtractorFunction } from 'gettext-extractor/dist/js/parser';
import { Validate } from 'gettext-extractor/dist/utils/validate';
import { IContentOptions, normalizeContent, validateContentOptions } from 'gettext-extractor/dist/utils/content';
import { IArgumentIndexMapping } from 'gettext-extractor/dist/js/extractors/common';
import { JsUtils } from 'gettext-extractor/dist/js/utils';

interface ICustomCommentOptions {
    commentString?: string;
    props?: Record<string, [string, string]>;
    throwWhenMalformed?: boolean;
    fallback?: boolean;
}

interface ICustomArgumentIndexMapping extends IArgumentIndexMapping {
    comments?: number;
}

export interface ICustomJsExtractorOptions {
    arguments: ICustomArgumentIndexMapping;
    comments?: ICustomCommentOptions;
    content?: IContentOptions;
}

interface IArgumentExpressions {
    text: ts.LiteralExpression | undefined;
    textPlural: ts.LiteralExpression | undefined;
    context: ts.LiteralExpression | undefined ;
    comments: ts.ObjectLiteralExpression | undefined;
}

type IndicesArgs = 'text' | 'textPlural' | 'comments' | 'context' | undefined;

type Indices = [IndicesArgs, number][];

type TypeFunctionArray = (typeof isTextLiteral | ((expression: ts.Expression) => boolean) | typeof isNullOrTextLiteral)[];

type ArgTypes = ('c' | 't' | 'o')[];

type CommentsObject = {
   comment: string[];
   otherComments: string[];
   propComments: string[];
   keyedComments: string[];
};

export function callExpressionExtractor(calleeName: string | string[], options: ICustomJsExtractorOptions): IJsExtractorFunction {
    Validate.required.argument({calleeName});
    let calleeNames = ([] as string[]).concat(calleeName);

    for (let name of calleeNames) {
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError(`Argument 'calleeName' must be a non-empty string or an array containing non-empty strings`);
        }
    }

    validateCustomOptions(options);
    validateContentOptions(options);
    Validate.optional.numberProperty(options, 'options.arguments.comments');
    let contentOptions: IContentOptions = {
        trimWhiteSpace: false,
        preserveIndentation: true,
        replaceNewLines: false
    };

    if (options.content) {
        if (options.content.trimWhiteSpace !== undefined) {
            contentOptions.trimWhiteSpace = options.content.trimWhiteSpace;
        }
        if (options.content.preserveIndentation !== undefined) {
            contentOptions.preserveIndentation = options.content.preserveIndentation;
        }
        if (options.content.replaceNewLines !== undefined) {
            contentOptions.replaceNewLines = options.content.replaceNewLines;
        }
    }

    let commentOptions: ICustomCommentOptions;

    if (options.comments) {
        commentOptions = {
            commentString: 'comment',
            throwWhenMalformed: true,
            fallback: false
        };
        if (options.comments.commentString !== undefined) {
            commentOptions.commentString = options.comments.commentString;
        }
        if (options.comments.throwWhenMalformed !== undefined) {
            commentOptions.throwWhenMalformed = options.comments.throwWhenMalformed;
        }
        if (options.comments.fallback !== undefined) {
            commentOptions.fallback = options.comments.fallback;
        }
        if (options.comments.props !== undefined) {
            commentOptions.props = options.comments.props;
        }
    }

    return (node: ts.Node, sourceFile: ts.SourceFile, addMessage: IAddMessageCallback) => {
        if (node.kind === ts.SyntaxKind.CallExpression) {
            let callExpression = <ts.CallExpression>node;

            let matches = calleeNames.reduce((matchFound, name) => (
                matchFound || JsUtils.calleeNameMatchesCallExpression(name, callExpression)
            ), false);

            if (matches) {
                let message = extractArguments(callExpression, options.arguments, contentOptions, commentOptions);
                if (message) {
                    addMessage(message);
                }
            }
        }
    };
}

function validateCustomOptions(options: ICustomJsExtractorOptions): void {
    Validate.required.numberProperty(options, 'options.arguments.text');
    Validate.optional.numberProperty(options, 'options.arguments.textPlural');
    Validate.optional.numberProperty(options, 'options.arguments.context');
    Validate.optional.numberProperty(options, 'options.arguments.comments');
    Validate.optional.booleanProperty(options, 'options.comments.throwWhenMalformed');
    Validate.optional.stringProperty(options, 'options.comments.commentString');

    if (options.comments && options.comments.props) {
        Object.entries(options.comments.props).forEach(([key, value]) => {
           if (!(Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string')) {
               throw new TypeError(`Entry for comments.props.${key} has to be of type Array and contain two strings.`);
           }
        });
    }
}

function getFallback(parent: ArgTypes): ArgTypes | undefined {
    if (parent.length > 1) {
        if (parent[0] === 'c') {
            return parent.slice(1);
        } else if (parent.length > 1 && parent[0] === 'o' && ['c', 'o'].includes(parent[1])) {
            return parent.slice(1);
        }
    }
    return undefined;
}

function getArgumentExpressionsArray(
    typeFunctionArray: TypeFunctionArray,
    argumentArray: ts.Expression[],
    args: IndicesArgs[],
    argTypes: ArgTypes,
    fallback: boolean
): IArgumentExpressions {
    let argumentExpressions: IArgumentExpressions = {text: undefined, textPlural: undefined, context: undefined, comments: undefined};

    for (let i = 0; i < argTypes.length; i++) {
        if (typeFunctionArray[i](argumentArray[i])) {
            if (!isNullOrUndefined(argumentArray[i])) {
                // @ts-ignore
                argumentExpressions[args[i]] = argumentArray[i];
            }
        } else if (fallback) {
            const fallbackArgTypes = getFallback(argTypes.slice(i));
            if (fallbackArgTypes) {
                argumentExpressions = {...argumentExpressions, ...Object.fromEntries(Object.entries(
                    getArgumentExpressionsArray(
                        typeFunctionArray.slice(i + 1),
                        argumentArray.slice(i),
                        args.slice(i + 1),
                        fallbackArgTypes,
                        fallback
                    )
                    ).filter(([_, value]) => value))};
                return argumentExpressions;
            }
            break;
        } else {
            break;
        }
    }

    return argumentExpressions;
}

function getArgumentExpressions(
    callArguments: ts.NodeArray<ts.Expression>,
    argumentMapping: ICustomArgumentIndexMapping,
    commentOptions: ICustomCommentOptions | undefined
): IArgumentExpressions {
    const indices = <Indices>Object.entries(argumentMapping).sort((a, b) => a[1] - b[1]);
    const args = indices.map(([arg, _]) => arg);
    const argTypes = args.map(arg => arg === 'text' ? 't' : arg === 'comments' ? 'c' : 'o');
    const positions = indices.map(([_, position]) => position);
    const argumentArray:  ts.Expression[] = [];
    const typeFunctionArray: TypeFunctionArray = [];
    const fallback = commentOptions !== undefined && commentOptions.fallback === true;

    const isNullOrObjectLiteralOrLiteralExpression = commentOptions
        ? fallback
            ? isNullOrObjectLiteralExpression
            : isNullOrObjectLiteralOrTextLiteral
        : isNullOrTextLiteral;
    positions.forEach(position => {
        argumentArray.push(checkAndConcatenateStrings(callArguments[position]));
        typeFunctionArray.push(
            argumentMapping.comments === position
                ?  isNullOrObjectLiteralOrLiteralExpression
                : argumentMapping.text === position
                    ? isTextLiteral
                    : isNullOrTextLiteral
        );
    });

    return getArgumentExpressionsArray(typeFunctionArray, argumentArray, args, argTypes, fallback);
}

function extractArguments(
    callExpression: ts.CallExpression,
    argumentMapping: ICustomArgumentIndexMapping,
    contentOptions: IContentOptions,
    commentOptions: ICustomCommentOptions | undefined
): IMessageData | null {
    let callArguments = callExpression.arguments;
    const argumentExpressions = getArgumentExpressions(callArguments, argumentMapping, commentOptions);
    let commentsExpression = argumentExpressions['comments'];

    if (argumentExpressions.text) {
        let message: IMessageData = {
            text: normalizeContent(argumentExpressions.text.text, contentOptions)
        };
        if (argumentExpressions.textPlural) {
            message.textPlural = normalizeContent(argumentExpressions.textPlural.text, contentOptions);
        }
        if (argumentExpressions.context) {
            message.context = normalizeContent(argumentExpressions.context.text, contentOptions);
        }
        if (commentsExpression && commentOptions && isObjectLiteralExpression(commentsExpression)) {
            const commentsObject = <CommentsObject>{comment: [], propComments: [], keyedComments: [], otherComments: []};
            getComments(commentsExpression, undefined, commentOptions, commentsObject, message);
            message.comments = [...commentsObject.comment, ...commentsObject.otherComments, ...commentsObject.propComments, ...commentsObject.keyedComments];
        } else if (commentsExpression && isTextLiteral(commentsExpression)) {
            message.comments = [...normalizeContent(commentsExpression.text, contentOptions).split('\n')];
        }
        return message;
    }

    return null;
}

function getComments(
    objectLiteralExpression: ts.ObjectLiteralExpression,
    prevKey: string | undefined,
    commentOptions: ICustomCommentOptions,
    comments: CommentsObject,
    message: IMessageData,
    isProp: boolean = false,
    propsKeys?: string[]
): void {

    if (!propsKeys) {
        propsKeys = commentOptions.props ? Object.keys(commentOptions.props) : [];
    }

    if (commentOptions.throwWhenMalformed === undefined) {
        commentOptions.throwWhenMalformed = true;
    }

    const properties = objectLiteralExpression.properties;

    properties.forEach(property => {
        if (property.kind === ts.SyntaxKind.PropertyAssignment) {
            const key = (<string>(<ts.Identifier>(<ts.PropertyAssignment>property).name).escapedText);
            const value = checkAndConcatenateStrings((<ts.PropertyAssignment>property).initializer);
            const nextKey = prevKey !== undefined ? `${prevKey}.${key}` : key;

            if ([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral].includes(value.kind)) {
                const commentsArray = (<ts.NoSubstitutionTemplateLiteral>value).text.split('\n');
                if (!prevKey && !isProp && key === commentOptions.commentString) {
                    comments.comment.push(...commentsArray);
                } else if (isProp && prevKey && prevKey !== 'comment') {
                    const braces = commentOptions.props![prevKey];
                    comments.propComments.push(...commentsArray.map(line => `${braces[0]}${key}${braces[1]}: ${line}`));
                } else if (prevKey) {
                    comments.keyedComments.push(...commentsArray.map(line => `${nextKey}: ${line}`));
                } else {
                    comments.otherComments.push(...commentsArray.map(line => `${nextKey}: ${line}`));
                }
            } else if (isObjectLiteralExpression(value)) {
                if (!prevKey && (<string []>propsKeys).includes(key)) {
                    getComments(value, key, commentOptions, comments, message, true, propsKeys);
                } else {
                    getComments(value, nextKey, commentOptions, comments, message, false, propsKeys);
                }
            } else if (commentOptions.throwWhenMalformed) {
                throw new Error(`Key ${nextKey} at "${message.text}" with id "${message.context}" has invalid value. Allowed are string or object.`);
            }
        }
    });
}

function isTextLiteral(expression: ts.Expression): expression is ts.LiteralExpression {
    return expression && (expression.kind === ts.SyntaxKind.StringLiteral || expression.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral);
}

function isObjectLiteralExpression(expression: ts.Expression): expression is ts.ObjectLiteralExpression {
    return expression && expression.kind === ts.SyntaxKind.ObjectLiteralExpression;
}

function isParenthesizedExpression(expression: ts.Expression): expression is ts.ParenthesizedExpression {
    return expression && expression.kind === ts.SyntaxKind.ParenthesizedExpression;
}

function isBinaryExpression(expression: ts.Expression): expression is ts.BinaryExpression {
    return expression && expression.kind === ts.SyntaxKind.BinaryExpression;
}

function isNull(expression: ts.Expression): expression is ts.NullLiteral {
    return expression && expression.kind === ts.SyntaxKind.NullKeyword;
}

function isUndefined(expression: ts.Expression): expression is ts.Identifier {
    return expression && expression.kind === ts.SyntaxKind.Identifier && (<ts.Identifier>expression).escapedText === 'undefined';
}

function isNumericLiteral(expression: ts.Expression): expression is ts.NumericLiteral {
    return expression && expression.kind === ts.SyntaxKind.NumericLiteral;
}

function isZeroNumericLiteral(expression: ts.Expression): expression is ts.NumericLiteral {
    return isNumericLiteral(expression) && expression.text === '0';
}

function isNullOrUndefined(expression: ts.Expression): boolean {
    return isNull(expression) || isUndefined(expression) || isZeroNumericLiteral(expression);
}

function isNullOrTextLiteral(expression: ts.Expression): boolean {
    return isNullOrUndefined(expression) || isTextLiteral(expression);
}

function isNullOrObjectLiteralExpression(expression: ts.Expression): boolean {
    return isObjectLiteralExpression(expression) || isNullOrUndefined(expression);
}

function isNullOrObjectLiteralOrTextLiteral(expression: ts.Expression): boolean {
    return isNullOrObjectLiteralExpression(expression) || isTextLiteral(expression);
}

function createStringLiteral(text: string): ts.StringLiteral {
    const node = <ts.StringLiteral>ts.createNode(ts.SyntaxKind.StringLiteral, -1, -1);
    node.text = text;
    return node;
}

function getAdditionExpression(expression: ts.Expression): ts.BinaryExpression | null {
    while (isParenthesizedExpression(expression)) {
        expression = expression.expression;
    }

    if (isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return expression;
    }

    return null;
}

function checkAndConcatenateStrings(expression: ts.Expression): ts.Expression {
    let addition: ts.BinaryExpression | null;

    if (!expression || !(addition = getAdditionExpression(expression))) {
        return expression;
    }

    let concatenated = createStringLiteral('');

    if (processStringAddition(addition, concatenated)) {
        return concatenated;
    }

    return expression;
}

function processStringAddition(expression: ts.BinaryExpression, concatenated: ts.StringLiteral): boolean {
    let addition: ts.BinaryExpression | null;

    if (isTextLiteral(expression.left)) {
        concatenated.text += expression.left.text;
    } else if (addition = getAdditionExpression(expression.left)) {
        if (!processStringAddition(addition, concatenated)) {
            return false;
        }
    } else {
        return false;
    }

    if (isTextLiteral(expression.right)) {
        concatenated.text += expression.right.text;
        return true;
    } else if (addition = getAdditionExpression(expression.right)) {
        return processStringAddition(addition, concatenated);
    } else {
        return false;
    }
}
