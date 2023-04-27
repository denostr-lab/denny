import React from 'react';
import PropTypes from 'prop-types';
import './Header.scss';

function Header({ children, className = "" }) {
  return (
    <div className={`header ${className}`}>
      {children}
    </div>
  );
}

Header.propTypes = {
  children: PropTypes.node.isRequired,
};

function TitleWrapper({ children }) {
  return (
    <div className="header__title-wrapper">
      {children}
    </div>
  );
}

TitleWrapper.propTypes = {
  children: PropTypes.node.isRequired,
};

export { Header as default, TitleWrapper };
